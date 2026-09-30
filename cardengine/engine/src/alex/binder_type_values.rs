//! Type-valued fields: a field typed `type UnitCard` holds the name of a type declaration (`@Creature`). The named type
//! must have every field the record requires; it is then mapped onto the record. A port of
//! `AlexBinder.TypeValues.cs`.

use super::binder::*;
use super::model::*;

impl Binder<'_> {
    /// Walks a document's values with the types their positions give them, and turns every reference that stands where
    /// a type is expected into the type it names, mapping that type onto the record.
    pub(super) fn map_type_values(&mut self, value: ValueId, expected: Option<TypeId>, s: usize) -> ValueId {
        let expected = expected.map(|e| self.model.resolved(e));
        let chosen = self.choose(value, expected, s);
        if let ValueKind::Reference { .. } = self.model.values[value].kind {
            if let Some(chosen) = chosen {
                if let Some(type_of_type) = self.type_of_type_for(value, chosen, s) {
                    return self.to_type_value(value, type_of_type, s, Sink::Document);
                }
            }
            return value;
        }

        match self.model.values[value].kind.clone() {
            ValueKind::Array(array) => {
                let unwrapped = self.unwrap_type(chosen);
                let (element, tuple) = match unwrapped.map(|u| self.model.types[u].kind.clone()) {
                    Some(TypeKind::List(element)) => (Some(element), None),
                    Some(TypeKind::Tuple(items)) => (None, Some(items)),
                    _ => (None, None),
                };
                for (i, item) in array.into_iter().enumerate() {
                    let item_type = match &tuple {
                        Some(items) => items.get(i).copied(),
                        None => element,
                    };
                    let mapped = self.map_type_values(item, item_type, s);
                    self.replace_item(value, i, mapped);
                }
                value
            }
            ValueKind::Object(object) if object.is_map => {
                if !self.mapped_objects.insert(value) {
                    return value;
                }
                let value_type = match self.unwrap_type(chosen).map(|u| self.model.types[u].kind.clone()) {
                    Some(TypeKind::Map(_, value_type)) => Some(value_type),
                    _ => None,
                };
                for (i, property) in object.properties.iter().enumerate() {
                    let mapped = self.map_type_values(property.value, value_type, s);
                    self.model.object_mut(value).unwrap().properties[i].value = mapped;
                }
                value
            }
            ValueKind::Object(object) => {
                if !self.mapped_objects.insert(value) {
                    return value;
                }
                for (i, property) in object.properties.iter().enumerate() {
                    if property.is_default {
                        continue;
                    }
                    let field_type = object.record_type.and_then(|t| self.model.field_of(t, &property.name)).map(|f| self.model.fields[f].field_type);
                    let mapped = self.map_type_values(property.value, field_type, s);
                    self.model.object_mut(value).unwrap().properties[i].value = mapped;
                }
                value
            }
            _ => value,
        }
    }

    /// Where `type_id` is a union of collections, the one a collection value is walked as: the first whose type values
    /// all fit, judged without changing anything. Any other type is returned as it is.
    fn choose(&mut self, value: ValueId, type_id: Option<TypeId>, s: usize) -> Option<TypeId> {
        let type_id = type_id?;
        let is_collection = match &self.model.values[value].kind {
            ValueKind::Array(_) => true,
            ValueKind::Object(o) => o.is_map,
            _ => false,
        };
        let unwrapped = self.unwrap_type(Some(type_id));
        let Some(union) = unwrapped.filter(|u| matches!(self.model.types[*u].kind, TypeKind::Union(_))) else { return Some(type_id) };
        if !is_collection {
            return Some(type_id);
        }

        let mut alternatives = Vec::new();
        self.flatten(union, &mut alternatives);
        let mut first: Option<TypeId> = None;
        for alternative in alternatives {
            if !self.fits(value, alternative) {
                continue;
            }
            if first.is_none() {
                first = Some(alternative);
            }
            if self.type_values_fit(value, alternative, s) {
                return Some(alternative);
            }
        }
        Some(first.unwrap_or(type_id))
    }

    /// Whether every reference directly in `value` that stands where a type is expected names a type that conforms.
    fn type_values_fit(&mut self, value: ValueId, type_id: TypeId, s: usize) -> bool {
        let element = match &self.model.types[type_id].kind {
            TypeKind::List(element) => Some(*element),
            TypeKind::Map(_, value_type) => Some(*value_type),
            _ => None,
        };
        let Some(element) = element else { return true };
        let item_values: Vec<ValueId> = match &self.model.values[value].kind {
            ValueKind::Array(array) => array.clone(),
            ValueKind::Object(object) => object.properties.iter().map(|p| p.value).collect(),
            _ => Vec::new(),
        };

        for item in item_values {
            if let ValueKind::Reference { .. } = self.model.values[item].kind {
                let resolved = self.model.resolved(element);
                if let Some(type_of_type) = self.type_of_type_for(item, resolved, s) {
                    if !self.type_value_problems(item, type_of_type, s).0.is_empty() {
                        return false;
                    }
                }
            }
            if let ValueKind::TypeValue(named) = self.model.values[item].kind {
                if !self.type_value_fits_any(named, element) {
                    return false;
                }
            }
        }
        true
    }

    fn type_value_fits_any(&mut self, named: TypeId, type_id: TypeId) -> bool {
        let mut alternatives = Vec::new();
        self.flatten(type_id, &mut alternatives);
        alternatives.iter().any(|a| matches!(self.model.types[*a].kind, TypeKind::TypeOfType { record } if self.model.is_or_viewed_as(named, record)))
    }

    /// The `type R` a reference standing where `expected` is expected is read against, or none when it is an ordinary
    /// reference. In a union that also holds values, a reference is a type only when it names one.
    pub(super) fn type_of_type_for(&mut self, reference: ValueId, expected: TypeId, s: usize) -> Option<TypeId> {
        let mut alternatives = Vec::new();
        self.flatten(expected, &mut alternatives);
        let mut type_of_types: Vec<TypeId> = Vec::new();
        let mut others = false;
        for alternative in &alternatives {
            match &self.model.types[*alternative].kind {
                TypeKind::TypeOfType { .. } => type_of_types.push(*alternative),
                TypeKind::Named { name, .. } if name == "nic" => {}
                _ => others = true,
            }
        }

        if type_of_types.is_empty() {
            return None;
        }
        let path = match &self.model.values[reference].kind {
            ValueKind::Reference { path, .. } => path.clone(),
            _ => Vec::new(),
        };
        let named = if path.len() == 1 { self.type_named(&path[0], s).map(|t| self.model.resolved(t)).filter(|t| self.model.record(*t).is_some()) } else { None };
        if named.is_none() && others {
            return None;
        }
        if let Some(candidate) = named {
            if type_of_types.len() > 1 {
                for type_of_type in &type_of_types {
                    let TypeKind::TypeOfType { record } = self.model.types[*type_of_type].kind else { continue };
                    if self.model.is_or_viewed_as(candidate, record) || self.conformance(candidate, record).is_empty() {
                        return Some(*type_of_type);
                    }
                }
            }
        }
        Some(type_of_types[0])
    }

    /// Why `reference` cannot name a type that `expected` takes, one sentence per problem, with the type it names when it
    /// names one. Changes nothing.
    fn type_value_problems(&mut self, reference: ValueId, expected: TypeId, s: usize) -> (Vec<String>, Option<TypeId>) {
        let TypeKind::TypeOfType { record: view } = self.model.types[expected].kind else { return (Vec::new(), None) };
        let path = match &self.model.values[reference].kind {
            ValueKind::Reference { path, .. } => path.clone(),
            _ => Vec::new(),
        };
        let name = path.join(".");
        let view_name = self.model.record_name(view).to_string();
        let mut problems = Vec::new();
        if path.len() != 1 {
            problems.push(format!(
                "'@{}' is a path, and this holds a type, named by itself: '@{}'. Type names are not qualified.",
                name,
                path[path.len() - 1]
            ));
            return (problems, None);
        }

        let declared = self.type_named(&name, s);
        let Some(record) = declared.map(|t| self.model.resolved(t)).filter(|t| self.model.record(*t).is_some()) else {
            problems.push(if declared.is_none() {
                format!(
                    "Nothing declares a type named '{}', and this holds a type that has {}'s fields. The record types that do are: {}.",
                    name,
                    with_article(&view_name),
                    self.conforming_type_names(view)
                )
            } else {
                format!("'{}' is not a record type, and this holds a type that has {}'s fields.", name, with_article(&view_name))
            });
            return (problems, None);
        };

        if self.model.is_or_viewed_as(record, view) {
            return (problems, Some(record));
        }
        let missing = self.conformance(record, view);
        for problem in &missing {
            problems.push(format!("'@{}' cannot stand for {}: {}", name, with_article(&view_name), problem));
        }
        if missing.is_empty() {
            if let Some(conflict) = self.mapping_conflict(record, view) {
                problems.push(conflict);
            }
        }
        (problems, Some(record))
    }

    /// The type `reference` names, checked to have every field `expected`'s record requires and mapped onto it; or the
    /// reference itself, reported, when it names no such type. In a union's trial it only reports.
    pub(super) fn to_type_value(&mut self, reference: ValueId, expected: TypeId, s: usize, sink: Sink) -> ValueId {
        let (problems, type_id) = self.type_value_problems(reference, expected, s);
        let span = self.model.values[reference].span;
        if self.trials > 0 {
            for problem in problems {
                self.report(sink, s, problem, span);
            }
            return reference;
        }

        // Whatever the reference would have named as a value, it names a type here; it is never reported as unresolved.
        if let Some(pending) = self.reference_lookup.get(&reference).copied() {
            self.references[pending].reported = true;
        }
        if let ValueKind::Reference { target, .. } = &mut self.model.values[reference].kind {
            *target = None;
        }

        let result = match type_id {
            None => reference,
            Some(t) => self.model.add_value(ValueKind::TypeValue(t), span),
        };
        if !problems.is_empty() {
            for problem in problems {
                self.report(sink, s, problem, span);
            }
            self.reported_type_values.insert(result);
            return result;
        }

        let TypeKind::TypeOfType { record } = self.model.types[expected].kind else { return result };
        let type_id = type_id.unwrap();
        if !self.model.is_or_viewed_as(type_id, record) {
            self.model.map_onto(type_id, record);
        }
        result
    }

    /// What keeps `type_id` from having `view`'s fields: one sentence per field the view requires that the type does not
    /// declare or inherit, or declares with a type the view's field does not take.
    pub(super) fn conformance(&mut self, type_id: TypeId, view: TypeId) -> Vec<String> {
        let mut problems = Vec::new();
        let type_name = self.model.record_name(type_id).to_string();
        let view_name = self.model.record_name(view).to_string();
        for wanted in self.model.fields_of(view) {
            let wanted_name = self.model.fields[wanted].name.clone();
            if self.model.fixed_value(view, &wanted_name).is_some() {
                continue;
            }
            // A field of a base both share is the type's own, even where its own declaration hides it (8.1).
            if self.model.fields[wanted].declaring_type.is_some_and(|d| self.model.is_or_extends(type_id, d)) {
                continue;
            }
            let wanted_type = self.model.fields[wanted].field_type;
            let Some(has) = self.model.field_of(type_id, &wanted_name) else {
                if self.model.is_required(wanted) {
                    let shown = self.model.type_string(wanted_type);
                    problems.push(format!(
                        "{} requires '{}' ({}), and {} does not declare it. Add '{}: {}' to {}.",
                        with_article(&view_name),
                        wanted_name,
                        shown,
                        type_name,
                        wanted_name,
                        shown,
                        type_name
                    ));
                }
                continue;
            };

            let has_type = self.model.fields[has].field_type;
            if !self.includes(wanted_type, has_type) {
                problems.push(format!(
                    "{}'s '{}' is {}, and {}'s '{}' is {}.",
                    type_name,
                    wanted_name,
                    self.model.type_string(has_type),
                    with_article(&view_name),
                    wanted_name,
                    self.model.type_string(wanted_type)
                ));
            }
        }
        problems
    }

    /// Why mapping `type_id` onto `view` would give it a member twice, or none.
    fn mapping_conflict(&self, type_id: TypeId, view: TypeId) -> Option<String> {
        // What the mapping adds reaches the type and every subtype of it, so each of them must be free of the names.
        let gained = self.model.extension_members(view);
        let type_name = self.model.record_name(type_id).to_string();
        let view_name = self.model.record_name(view).to_string();
        let mut affected = vec![type_id];
        for subtype in self.all_types() {
            if self.model.record(subtype).is_some() && subtype != type_id && self.model.is_or_extends(subtype, type_id) {
                affected.push(subtype);
            }
        }

        for target in affected {
            let target_name = self.model.record_name(target).to_string();
            let which = if target == type_id { type_name.clone() } else { format!("{}, which extends {},", target_name, type_name) };
            let existing = self.model.extension_members(target);
            for gained_member in &gained {
                let name = &self.model.fields[*gained_member].name;
                let gained_from = self.declaring_name(self.model.fields[*gained_member].declaring_type);
                if let Some(field) = self.model.field_of(target, name) {
                    let declaring = self.model.fields[field].declaring_type;
                    let from = if declaring == Some(target) { String::new() } else { format!(", from {}", self.declaring_name(declaring)) };
                    return Some(format!(
                        "Mapping {} onto {} would give it the member '{}' (from {}), and {} already has a field '{}'{}.",
                        type_name, view_name, name, gained_from, which, name, from
                    ));
                }

                for existing_member in &existing {
                    if *existing_member == *gained_member || self.model.fields[*existing_member].name != *name {
                        continue;
                    }
                    let who = if target == type_id { "it".to_string() } else { target_name.clone() };
                    return Some(format!(
                        "Mapping {} onto {} would give {} '{}' twice: from {} and from {}. A type mapped onto several records takes each member from one of them.",
                        type_name,
                        view_name,
                        who,
                        name,
                        gained_from,
                        self.declaring_name(self.model.fields[*existing_member].declaring_type)
                    ));
                }
            }
        }
        None
    }

    /// The record types that already have every field `view` requires, for a diagnostic.
    fn conforming_type_names(&mut self, view: TypeId) -> String {
        let mut names: Vec<String> = Vec::new();
        for (name, type_id) in self.type_names.clone() {
            if self.model.record(type_id).is_some() && self.conformance(type_id, view).is_empty() {
                names.push(name);
            }
        }
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        if names.is_empty() { "(none)".to_string() } else { names.join(", ") }
    }

    /// Whether every value of `narrow` is a value of `wide`.
    pub(super) fn includes(&mut self, wide: TypeId, narrow: TypeId) -> bool {
        let mut wides = Vec::new();
        let mut narrows = Vec::new();
        self.flatten(wide, &mut wides);
        self.flatten(narrow, &mut narrows);
        for n in narrows {
            let mut found = false;
            for w in &wides {
                if found {
                    break;
                }
                found = self.includes_one(*w, n);
            }
            if !found {
                return false;
            }
        }
        true
    }

    fn includes_one(&mut self, wide: TypeId, narrow: TypeId) -> bool {
        if wide == narrow {
            return true;
        }
        if matches!(self.model.types[wide].kind, TypeKind::Invalid) || matches!(self.model.types[narrow].kind, TypeKind::Invalid) {
            return true;
        }

        let narrow_kind = self.model.types[narrow].kind.clone();
        match self.model.types[wide].kind.clone() {
            TypeKind::Named { name, .. } if name == "any" => true,
            TypeKind::Named { name, .. } if name == "data" => self.is_data(narrow),
            TypeKind::Named { name: wide_name, .. } => match narrow_kind {
                TypeKind::Named { name: narrow_name, .. } => wide_name == narrow_name || (wide_name == "float" && narrow_name == "int"),
                _ => false,
            },
            TypeKind::Record(_) => matches!(narrow_kind, TypeKind::Record(_)) && self.model.is_or_viewed_as(narrow, wide),
            TypeKind::TypeOfType { record: wide_record } => match narrow_kind {
                TypeKind::TypeOfType { record: narrow_record } => self.model.is_or_viewed_as(narrow_record, wide_record),
                _ => false,
            },
            TypeKind::Function { kind: wide_kind, .. } => matches!(narrow_kind, TypeKind::Function { kind, .. } if kind == wide_kind),
            TypeKind::List(wide_element) => match narrow_kind {
                TypeKind::List(narrow_element) => self.includes(wide_element, narrow_element),
                TypeKind::Tuple(items) => items.iter().all(|i| self.includes(wide_element, *i)),
                _ => false,
            },
            TypeKind::Tuple(wide_items) => match narrow_kind {
                TypeKind::Tuple(narrow_items) if narrow_items.len() == wide_items.len() => {
                    (0..narrow_items.len()).all(|i| self.includes(wide_items[i], narrow_items[i]))
                }
                _ => false,
            },
            TypeKind::Map(wide_key, wide_value) => match narrow_kind {
                TypeKind::Map(narrow_key, narrow_value) => self.includes(wide_key, narrow_key) && self.includes(wide_value, narrow_value),
                _ => false,
            },
            _ => false,
        }
    }
}
