//! The runtime: plays a game from its Alex source (docs/tcg/runtime-design.md). So far, its first two steps: the table
//! (the game state, the core's operations, the log with what each seat may see, the seeded randomness), and routines
//! running (the handlers, pausing for a player's decision, the scheduler). The hooks the library rules attach to come
//! next.

pub mod catalog;
pub mod interpret;
pub mod log;
pub mod ops;
pub mod random;
pub mod rules;
pub mod schedule;
pub mod state;
pub mod view;

pub use catalog::Catalog;
pub use ops::Position;
pub use state::{Game, Outcome, Seat, SeatSetup, Setup};
