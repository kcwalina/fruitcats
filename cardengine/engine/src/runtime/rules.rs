//! The game's handlers, found once when a game starts: every routine in its rules documents with its body, and which
//! slot of which card face (or keyword) each is attached to. The binder has already checked them; the runtime keeps
//! their bodies, re-read from the rules documents' text, so a game in play needs nothing else from the project.

use std::collections::{BTreeMap, HashMap};

use crate::alex::model::ValueId;
use crate::alex::parser::{self, ParseMode};
use crate::alex::syntax::{Body, BodyStatement, Expression, Statement, Value};
use crate::loader::project::Project;

#[derive(Clone, Debug)]
pub enum RoutineBody {
    Block(Vec<BodyStatement>),
    Expression(Expression),
    /// A wiring line's one statement: `@klobuk.on-enter = draw()`.
    Statement(BodyStatement),
}

#[derive(Clone, Debug)]
pub struct Routine {
    pub name: Option<String>,
    /// `routine x : bool`, a condition, or a condition slot's one expression: it answers yes or no.
    pub returns_bool: bool,
    /// The rules document it is written in, by index in `Handlers::sources`.
    pub source: usize,
    pub body: RoutineBody,
}

#[derive(Clone, Debug, Default)]
pub struct Handlers {
    /// Each rules document's text, which the bodies' tokens point into.
    pub sources: Vec<Vec<u8>>,
    pub routines: Vec<Routine>,
    pub by_name: BTreeMap<String, usize>,
    /// The routine attached to a slot of a value (a card face, a keyword): `(its value, "on-enter")`.
    pub slots: HashMap<(ValueId, String), usize>,
}

impl Handlers {
    pub fn read(project: &Project) -> Handlers {
        let model = &project.compilation.model;
        let mut handlers = Handlers::default();
        let mut trees: HashMap<usize, (usize, Vec<Statement>)> = HashMap::new();
        for declaration in &model.declarations {
            if declaration.kind == "scenario" {
                continue;
            }
            let document = declaration.document;
            let (source, statements) = trees.entry(document).or_insert_with(|| {
                let bytes = project.sources[document].clone();
                let tree = parser::parse(&bytes, ParseMode::Program);
                handlers.sources.push(bytes);
                (handlers.sources.len() - 1, tree.root.statements)
            });
            let source = *source;
            let body = match statements.get(declaration.statement) {
                Some(Statement::Declaration { body: Body::Block(block), .. }) => RoutineBody::Block(block.statements.clone()),
                Some(Statement::Declaration { body: Body::Expression { expression, .. }, .. }) => RoutineBody::Expression(expression.clone()),
                Some(Statement::ReferenceAssignment { value: Value::InlineStatement { statement }, .. }) => RoutineBody::Statement((**statement).clone()),
                _ => continue,
            };
            let returns_bool = declaration.kind == "condition"
                || matches!(&model.types[declaration.function_type].kind, crate::alex::model::TypeKind::Function { kind, .. } if kind == "condition");
            let routine = handlers.routines.len();
            handlers.routines.push(Routine { name: declaration.name.clone(), returns_bool, source, body });
            if let Some(name) = &declaration.name {
                handlers.by_name.insert(name.clone(), routine);
            }
            for attachment in &declaration.attachments {
                handlers.slots.insert((attachment.target, model.fields[attachment.member].name.clone()), routine);
            }
        }
        handlers
    }

    pub fn attached(&self, value: ValueId, slot: &str) -> Option<usize> {
        self.slots.get(&(value, slot.to_string())).copied()
    }
}
