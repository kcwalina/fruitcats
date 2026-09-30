//! The runtime: plays a game from its Alex source (docs/tcg/runtime-design.md). This is its first step, the table:
//! the game state, the core's operations, the log with what each seat may see, and the seeded randomness. Routines,
//! the scheduler and the hooks the library rules attach to come next.

pub mod catalog;
pub mod log;
pub mod ops;
pub mod random;
pub mod state;
pub mod view;

pub use catalog::Catalog;
pub use ops::Position;
pub use state::{Game, Outcome, Seat, SeatSetup, Setup};
