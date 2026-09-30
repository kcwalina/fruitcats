//! The scheduler (`core-operations.alex` part 5): routines don't run when raised; they are queued, and the game runs
//! them oldest first, with a state check between them. A routine runs on a copy of the game. If it finishes, the copy
//! becomes the game; if it needs a player's decision, the copy is dropped, so nothing happened yet, and the game waits
//! with the decision and the answers so far. The answer runs it again from the start with one more answer. So a
//! waiting game is plain data: it clones, saves and replays like any other.

use super::interpret::{Context, Decision, Run, Stop, Val};
use super::log::Value;
use super::state::{Game, ObjectId, Seat};

#[derive(Clone, Debug)]
pub struct Task {
    pub routine: usize,
    pub context: Context,
    pub answers: Vec<usize>,
    /// What raised it, for the log: `Kłobuk, on-enter`.
    pub cause: String,
}

#[derive(Clone, Debug)]
pub struct Waiting {
    pub task: Task,
    pub decision: Decision,
}

impl Game {
    /// Queues the routine attached to `slot` of the face `object` shows (`on-enter`, `on-play`), and says whether it
    /// has one.
    pub fn trigger(&mut self, object: ObjectId, slot: &str) -> bool {
        let o = &self.objects[object];
        let card = &self.catalog.cards[o.card];
        let face = (o.face as usize - 1).min(card.faces.len() - 1);
        let Some(routine) = self.catalog.handlers.attached(card.faces[face].value, slot) else { return false };
        let task = Task {
            routine,
            context: Context { this: Some(object), card: Some((o.card, face)), controller: o.controller.or(o.owner).unwrap_or(0) },
            answers: Vec::new(),
            cause: format!("{}, {}", card.name, slot),
        };
        self.pending.push_back(task);
        true
    }

    /// Runs queued routines until none is left or one waits for a decision.
    pub fn run(&mut self) -> Result<(), String> {
        while self.waiting.is_none() {
            let Some(task) = self.pending.pop_front() else { break };
            let mut trial = self.clone();
            trial.cause = Some(task.cause.clone());
            let result = Run::new(&mut trial, task.routine, task.context.clone(), task.answers.clone()).run();
            match result {
                Ok(_) => {
                    trial.cause = None;
                    *self = trial;
                    self.state_check();
                }
                Err(Stop::Need(decision)) => {
                    let options = decision.options.iter().map(|&o| self.mention(o)).collect();
                    self.log.push(super::log::Event {
                        name: "decision-required".to_string(),
                        cause: Some(task.cause.clone()),
                        fields: vec![
                            ("player".to_string(), Value::Seat(decision.seat)),
                            ("question".to_string(), Value::Text(decision.question.clone())),
                            ("options".to_string(), Value::Objects(options)),
                            ("optional".to_string(), Value::Bool(decision.optional)),
                        ],
                        only_to: Some(vec![decision.seat]),
                    });
                    self.waiting = Some(Waiting { task, decision });
                }
                Err(Stop::Fail(message)) => return Err(format!("{}: {}", task.cause, message)),
            }
        }
        Ok(())
    }

    /// The decision the game waits for, if any.
    pub fn decision(&self) -> Option<&Decision> {
        self.waiting.as_ref().map(|w| &w.decision)
    }

    /// Answers the waiting decision: an index into its options, or, when it is optional, `options.len()` to decline.
    /// Then runs on.
    pub fn answer(&mut self, seat: Seat, answer: usize) -> Result<(), String> {
        let Some(waiting) = self.waiting.take() else { return Err("No decision is waiting.".to_string()) };
        let decision = &waiting.decision;
        let valid = answer < decision.options.len() || (decision.optional && answer == decision.options.len());
        if seat != decision.seat || !valid {
            let reason = if seat != decision.seat { format!("player {} is to decide, not {}", decision.seat, seat) } else { format!("{} isn't one of the options", answer) };
            self.waiting = Some(waiting);
            self.log.push(super::log::Event { name: "answer-rejected".to_string(), cause: None, fields: vec![("reason".to_string(), Value::Text(reason.clone()))], only_to: Some(vec![seat]) });
            return Err(reason);
        }
        let chosen = decision.options.get(answer).map(|&o| self.mention(o));
        self.emit("chose", vec![("player", Value::Seat(seat)), ("choice", chosen.map(Value::Object).unwrap_or(Value::Text("none".to_string())))]);
        let mut task = waiting.task;
        task.answers.push(answer);
        self.pending.push_front(task);
        self.run()
    }

    /// Asks a condition slot (a Hero's `awaken`) of the face `object` shows, without changing the game. `None` when
    /// the face has nothing in that slot.
    pub fn ask(&self, object: ObjectId, slot: &str) -> Result<Option<bool>, String> {
        let o = &self.objects[object];
        let card = &self.catalog.cards[o.card];
        let face = (o.face as usize - 1).min(card.faces.len() - 1);
        let Some(routine) = self.catalog.handlers.attached(card.faces[face].value, slot) else { return Ok(None) };
        let context = Context { this: Some(object), card: Some((o.card, face)), controller: o.controller.or(o.owner).unwrap_or(0) };
        let mut trial = self.clone();
        match Run::new(&mut trial, routine, context, Vec::new()).run() {
            Ok(Val::Bool(b)) => Ok(Some(b)),
            Ok(Val::Int(n)) => Ok(Some(n != 0)),
            Ok(_) => Err(format!("{}'s {} doesn't answer yes or no.", card.name, slot)),
            Err(Stop::Need(_)) => Err(format!("{}'s {} asks a player to choose; a condition can't.", card.name, slot)),
            Err(Stop::Fail(message)) => Err(message),
        }
    }

    /// What must happen now, unprompted, between queued routines (`state-check` in the contract): defeats, a Hero
    /// awakening, a player losing. The game's rules answer it through their hooks, which come with the next step.
    fn state_check(&mut self) {}
}
