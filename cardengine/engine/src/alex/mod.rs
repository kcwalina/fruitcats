//! Alex: the language games are written in. Parsing, writing a tree back out byte for byte, and binding documents
//! together into values checked against their types.

pub mod binder;
mod binder_bodies;
mod binder_program;
mod binder_type_values;
pub mod bound_dump;
pub mod dump;
pub mod host;
pub mod identifiers;
pub mod lexer;
pub mod model;
pub mod parser;
pub mod syntax;
pub mod tokens;
pub mod writer;
