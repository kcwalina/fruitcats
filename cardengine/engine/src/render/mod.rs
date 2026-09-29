//! The card renderer: a card face laid out from the game's card layout as a draw list (`layout`, `draw`), its text
//! set as `text-layout.md` says (`text`) in the project's own fonts (`font`); and the draw list as pixels (`raster`).

pub mod draw;
pub mod font;
pub mod layout;
pub mod raster;
pub mod text;
