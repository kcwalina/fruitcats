//! What a host adds to binding: the kinds of declaration, the environment bodies are checked against, and validation of
//! its domain's rules after binding. A port of `AlexHost.cs`. The language knows the shape of a body; the host knows
//! its vocabulary.

use super::model::*;
use super::syntax::TextSpan;

/// A function a body may call: its parameters in positional order, and what it gives back.
#[derive(Clone, Debug)]
pub struct Signature {
    pub name: String,
    pub parameters: Vec<Parameter>,
    pub result: Option<TypeId>,
}

#[derive(Clone, Debug)]
pub struct Parameter {
    pub name: String,
    pub parameter_type: TypeId,
    pub is_optional: bool,
    /// Takes every positional argument from its place on, and every named argument that names no other parameter.
    pub absorbs: bool,
}

impl Signature {
    pub fn parameter(&self, name: &str) -> Option<&Parameter> {
        self.parameters.iter().find(|p| p.name == name)
    }

    /// "from: units, filters: filters (optional)": the parameters, for a diagnostic.
    pub fn parameter_list(&self, model: &Model) -> String {
        if self.parameters.is_empty() {
            return "none".to_string();
        }
        let mut text = String::new();
        for (i, parameter) in self.parameters.iter().enumerate() {
            if i > 0 {
                text.push_str(", ");
            }
            text.push_str(&parameter.name);
            text.push_str(": ");
            text.push_str(&model.type_string(parameter.parameter_type));
            if parameter.is_optional {
                text.push_str(" (optional)");
            }
            if parameter.absorbs {
                text.push_str(" (takes further arguments)");
            }
        }
        text
    }
}

/// What the binder tells an environment about the declaration whose body it is about to check.
pub struct ScopeRequest {
    pub declaration: DeclarationId,
    pub kind: String,
    /// The assignments this check is for: all of them to one member, so they share a meaning for `this`.
    pub attachments: Vec<Attachment>,
    /// Every type and enum the documents bound together declare, in the order declared.
    pub types: Vec<(String, TypeId)>,
    /// Each document's and schema's root, by its name.
    pub roots: Vec<(String, ValueId)>,
}

impl ScopeRequest {
    pub fn find_type(&self, name: &str) -> Option<TypeId> {
        self.types.iter().find(|(n, _)| n == name).map(|(_, t)| *t)
    }

    pub fn root(&self, name: &str) -> Option<ValueId> {
        self.roots.iter().find(|(n, _)| n == name).map(|(_, r)| *r)
    }

    pub fn attachment(&self) -> Option<&Attachment> {
        self.attachments.first()
    }
}

/// What a body may say. Every method has a default that says "nothing", so a host implements only what its language
/// has. Each may add types to the model (a host names its own opaque types).
#[allow(unused_variables)]
pub trait Scope {
    fn type_of(&self, model: &mut Model, name: &str) -> Option<TypeId> {
        None
    }
    fn names(&self, model: &mut Model) -> Vec<String> {
        Vec::new()
    }
    fn function(&self, model: &mut Model, name: &str) -> Option<Signature> {
        None
    }
    fn functions(&self, model: &mut Model) -> Vec<String> {
        Vec::new()
    }
    fn method(&self, model: &mut Model, receiver: TypeId, name: &str) -> Option<Signature> {
        None
    }
    fn methods(&self, model: &mut Model, receiver: TypeId) -> Vec<String> {
        Vec::new()
    }
    fn member(&self, model: &mut Model, receiver: TypeId, name: &str) -> Option<TypeId> {
        None
    }
    fn members(&self, model: &mut Model, receiver: TypeId) -> Vec<String> {
        Vec::new()
    }
    fn can_bind(&self, name: &str) -> bool {
        false
    }
    fn bindable(&self) -> Vec<String> {
        Vec::new()
    }
    fn word(&self, model: &mut Model, word: &str, expected: TypeId) -> Option<TypeId> {
        None
    }
    fn absorbed(&self, model: &mut Model, signature: &Signature, parameter: &Parameter, name: &str) -> Option<TypeId> {
        None
    }
    fn is_assignable(&self, model: &mut Model, value: TypeId, target: TypeId) -> bool {
        false
    }
}

/// A document as a host's validation sees it.
#[derive(Clone)]
pub struct DocumentView {
    pub index: usize,
    pub name: Option<String>,
    pub is_schema: bool,
    pub is_program: bool,
    pub root: ValueId,
}

/// What a host's validation sees of a bound compilation, and where it reports. Implemented by the binder.
pub trait ValidationContext {
    fn model(&self) -> &Model;
    fn documents(&self) -> Vec<DocumentView>;
    fn types(&self) -> Vec<(String, TypeId)>;
    /// The document or schema whose root is named `name`: documents first, then schemas.
    fn document(&self, name: &str) -> Option<DocumentView>;
    fn declaring_document_of_type(&self, type_id: TypeId) -> Option<DocumentView>;
    fn declaring_document_of_field(&self, field: FieldId) -> Option<DocumentView>;
    /// The document or schema `value` is written in.
    fn document_of(&mut self, value: ValueId) -> Option<DocumentView>;
    fn error(&mut self, document: usize, span: TextSpan, message: String);
}

/// The host: kinds of declaration, an environment for bodies, and validation. `None`'s defaults add nothing.
pub trait Host {
    fn kinds(&self) -> Vec<(String, BodyShape)>;
    /// Whether bodies are checked against an environment at all.
    fn has_environment(&self) -> bool {
        false
    }
    fn scope_for(&self, _model: &mut Model, _request: &ScopeRequest) -> Option<Box<dyn Scope>> {
        None
    }
    fn validate(&self, _context: &mut dyn ValidationContext) {}
}

/// A host that registers kinds of declaration and nothing else: bodies are checked only for their shape.
pub struct KindsHost {
    pub kinds: Vec<(String, BodyShape)>,
}

impl Host for KindsHost {
    fn kinds(&self) -> Vec<(String, BodyShape)> {
        self.kinds.clone()
    }
}
