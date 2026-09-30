//! The runtime's second step: routines run. Hello TCG's card handlers (samples/hello-tcg/card-rules.alex), each run
//! from its slot on a table set up with the core's operations. Playing a card and its rules (paying Energy, where it
//! goes) come with the next step; here a test puts a card where it would be and fires its slot.

use std::fs;
use std::path::Path;
use std::rc::Rc;

use kardix::loader::project::{self, Project, ProjectFile};
use kardix::runtime::{Catalog, Game, Position, SeatSetup, Setup};

fn hello_tcg() -> Project {
    fn walk(root: &Path, at: &Path, files: &mut Vec<ProjectFile>) {
        for entry in fs::read_dir(at).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, files);
            } else if path.extension().is_some_and(|e| e == "alex") {
                let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
                files.push(ProjectFile { path: relative, bytes: fs::read(&path).unwrap() });
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples/hello-tcg");
    let mut files = Vec::new();
    walk(&root, &root, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    project::load(files)
}

/// Seat 0 plays the Hearth deck (Dziadziuś, Hearth Cricket, Mane-Braiding Domowik, Kłobuk, A Domowik's Temper), seat
/// 1 the Threshold deck (Dziadziuś, Keeper of the Door, Bread-and-Salt Greeter, Kłobuk, the Temper).
fn new_game() -> Game {
    let catalog = Rc::new(Catalog::read(&hello_tcg()).unwrap());
    let setup = Setup { seats: vec![SeatSetup { deck: "hearth".to_string(), ..Default::default() }, SeatSetup { deck: "threshold".to_string(), ..Default::default() }], seed: 11 };
    Game::new(catalog, &setup).unwrap()
}

/// One of `seat`'s copies of a card, wherever it is.
fn copy_of(game: &Game, seat: usize, card: &str) -> usize {
    (0..game.objects.len()).find(|&o| game.objects[o].owner == Some(seat) && game.card_key(o) == card && !game.objects[o].gone).unwrap()
}

fn put(game: &mut Game, object: usize, zone: &str) {
    let owner = game.objects[object].owner;
    let zone = game.zone_named(zone, owner).unwrap();
    game.move_to(object, zone, Position::Bottom).unwrap();
}

fn count(game: &Game, zone: &str, seat: usize) -> usize {
    game.zones[game.zone_named(zone, Some(seat)).unwrap()].objects.len()
}

fn damage(game: &Game, object: usize) -> i64 {
    game.objects[object].counters.get("damage").copied().unwrap_or(0)
}

#[test]
fn every_handler_is_found_and_attached() {
    let catalog = Catalog::read(&hello_tcg()).unwrap();
    let handlers = &catalog.handlers;
    let klobuk = &catalog.cards[catalog.card("klobuk").unwrap()];
    assert!(handlers.attached(klobuk.faces[0].value, "on-enter").is_some());
    let hero = &catalog.cards[catalog.card("dziadzius").unwrap()];
    assert_eq!(hero.faces.len(), 2);
    let front = handlers.attached(hero.faces[0].value, "exhaust").unwrap();
    assert_eq!(handlers.attached(hero.faces[1].value, "exhaust"), Some(front), "both faces share gain-energy");
    assert!(handlers.routines[handlers.attached(hero.faces[0].value, "awaken").unwrap()].returns_bool);
    assert_eq!(hero.faces[0].constants.get("energy"), Some(&1));
    assert_eq!(hero.faces[1].constants.get("energy"), Some(&2));
    assert_eq!(catalog.unit_types, ["Creature"]);
}

#[test]
fn klobuk_draws_a_card_when_it_enters() {
    let mut game = new_game();
    let klobuk = copy_of(&game, 0, "klobuk");
    put(&mut game, klobuk, "Board");
    let hand = count(&game, "Hand", 0);
    assert!(game.trigger(klobuk, "on-enter"));
    game.run().unwrap();
    assert_eq!(count(&game, "Hand", 0), hand + 1);
    let last = game.log_json(None, game.log.len() - 1);
    assert!(last.contains("\"to\":\"Hand/0\"") && last.contains("\"cause\":\"Kłobuk, on-enter\""), "{}", last);
}

#[test]
fn the_greeter_heals_each_of_your_creatures() {
    let mut game = new_game();
    let greeter = copy_of(&game, 1, "bread-and-salt-greeter");
    let keeper = copy_of(&game, 1, "keeper-of-the-door");
    let enemy = copy_of(&game, 0, "hearth-cricket");
    for (object, hurt) in [(keeper, 3), (enemy, 1)] {
        put(&mut game, object, "Board");
        game.add_counter(object, "damage", hurt).unwrap();
    }
    put(&mut game, greeter, "Board");
    game.trigger(greeter, "on-enter");
    game.run().unwrap();
    assert_eq!(damage(&game, keeper), 1, "healed by the Greeter's heal = 2");
    assert_eq!(damage(&game, enemy), 1, "not your Creature");
}

#[test]
fn the_temper_waits_for_its_player_to_choose_then_deals_its_damage() {
    let mut game = new_game();
    let keeper = copy_of(&game, 1, "keeper-of-the-door");
    let cricket = copy_of(&game, 0, "hearth-cricket");
    put(&mut game, keeper, "Board");
    put(&mut game, cricket, "Board");
    let temper = copy_of(&game, 0, "domowiks-temper");
    put(&mut game, temper, "Hand");
    game.trigger(temper, "on-play");
    game.run().unwrap();

    let decision = game.decision().expect("the Temper asks which Creature").clone();
    assert_eq!(decision.seat, 0);
    assert_eq!(decision.options.len(), 2, "choose(all): any player's Creature");
    assert_eq!(damage(&game, keeper), 0, "nothing happens before the choice");
    assert!(game.log_json(Some(0), 0).contains("\"event\":\"decision-required\""));
    assert!(!game.log_json(Some(1), 0).contains("\"event\":\"decision-required\""), "only the deciding player sees the options");

    assert!(game.answer(1, 0).is_err(), "seat 1 isn't the one deciding");
    let index = decision.options.iter().position(|&o| o == keeper).unwrap();
    game.answer(0, index).unwrap();
    assert!(game.decision().is_none());
    assert_eq!(damage(&game, keeper), 5);
    assert_eq!(damage(&game, cricket), 0);
}

#[test]
fn a_waiting_game_clones_and_each_copy_goes_its_own_way() {
    let mut game = new_game();
    let keeper = copy_of(&game, 1, "keeper-of-the-door");
    let cricket = copy_of(&game, 0, "hearth-cricket");
    put(&mut game, keeper, "Board");
    put(&mut game, cricket, "Board");
    let temper = copy_of(&game, 0, "domowiks-temper");
    game.trigger(temper, "on-play");
    game.run().unwrap();
    let mut other = game.clone();
    let options = game.decision().unwrap().options.clone();
    game.answer(0, options.iter().position(|&o| o == keeper).unwrap()).unwrap();
    other.answer(0, options.iter().position(|&o| o == cricket).unwrap()).unwrap();
    assert_eq!((damage(&game, keeper), damage(&game, cricket)), (5, 0));
    assert_eq!((damage(&other, keeper), damage(&other, cricket)), (0, 5));
}

#[test]
fn dziadzius_awakens_with_three_creatures_and_each_face_gains_its_own_energy() {
    let mut game = new_game();
    let hero = copy_of(&game, 0, "dziadzius");
    put(&mut game, hero, "Hearth");
    assert_eq!(game.ask(hero, "awaken"), Ok(Some(false)));
    for card in ["hearth-cricket", "klobuk", "mane-braiding-domowik"] {
        let object = copy_of(&game, 0, card);
        put(&mut game, object, "Board");
    }
    assert_eq!(game.ask(hero, "awaken"), Ok(Some(true)), "Awaken: You control 3 or more Creatures");

    game.trigger(hero, "exhaust");
    game.run().unwrap();
    assert_eq!(game.players[0].counters.get("Energy"), Some(&1));
    game.flip(hero, 2).unwrap();
    game.trigger(hero, "exhaust");
    game.run().unwrap();
    assert_eq!(game.players[0].counters.get("Energy"), Some(&3), "the Awakened side gains 2");
    assert_eq!(game.ask(hero, "awaken"), Ok(None), "the back has no Awaken");
}

#[test]
fn a_choice_with_nothing_to_choose_does_nothing() {
    let mut game = new_game();
    let temper = copy_of(&game, 0, "domowiks-temper");
    game.trigger(temper, "on-play");
    game.run().unwrap();
    assert!(game.decision().is_none());
}

// ── Folkborn ─────────────────────────────────────────────────────────────────────────────────────

fn folkborn() -> Project {
    fn walk(root: &Path, at: &Path, files: &mut Vec<ProjectFile>) {
        for entry in fs::read_dir(at).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, files);
            } else if path.extension().is_some_and(|e| e == "alex") {
                let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
                files.push(ProjectFile { path: relative, bytes: fs::read(&path).unwrap() });
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../games/folkborn");
    let mut files = Vec::new();
    walk(&root, &root, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    project::load(files)
}

/// Every handler of Folkborn's that does something, fired once from its card on a table where both players have
/// units, hurt ones, exhausted Offerings and a deck, answering each choice with its first option. Statics and
/// conditions are left out: statics come with the next step, and conditions are asked, not fired.
#[test]
fn every_folkborn_card_handler_runs() {
    let project = folkborn();
    let catalog = Rc::new(Catalog::read(&project).unwrap());
    let cards: Vec<String> = catalog.cards.iter().map(|c| c.key.clone()).collect();
    let setup = Setup { seats: vec![SeatSetup { cards: cards.clone(), ..Default::default() }, SeatSetup { cards, ..Default::default() }], seed: 3 };
    let base = {
        let mut game = Game::new(catalog.clone(), &setup).unwrap();
        for seat in 0..2 {
            let units: Vec<usize> = (0..game.objects.len()).filter(|&o| game.objects[o].owner == Some(seat) && catalog.is_unit(game.objects[o].card)).take(3).collect();
            for unit in units {
                put(&mut game, unit, "Yard");
                game.add_counter(unit, "damage", 1).unwrap();
            }
            let offerings: Vec<usize> = (0..game.objects.len()).filter(|&o| game.objects[o].owner == Some(seat) && game.objects[o].zone == game.zone_named("Deck", Some(seat)).unwrap()).take(3).collect();
            for offering in offerings {
                put(&mut game, offering, "Offerings");
                game.set_state(offering, "exhausted", true).unwrap();
            }
        }
        game
    };
    let mut ran = 0;
    let mut failures = Vec::new();
    for (index, card) in catalog.cards.iter().enumerate() {
        for (face_index, face) in card.faces.iter().enumerate() {
            for slot in ["on-enter", "on-play", "on-defeated", "on-round-start", "exhaust", "on-defeats-in-combat", "on-you-heal"] {
                if catalog.handlers.attached(face.value, slot).is_none() {
                    continue;
                }
                let mut game = base.clone();
                let object = (0..game.objects.len()).find(|&o| game.objects[o].owner == Some(0) && game.objects[o].card == index).unwrap();
                if face_index == 1 {
                    game.flip(object, 2).unwrap();
                }
                game.trigger(object, slot);
                let mut result = game.run();
                while result.is_ok() && game.decision().is_some() {
                    result = game.answer(0, 0);
                }
                ran += 1;
                if let Err(e) = result {
                    failures.push(e);
                }
            }
        }
    }
    assert!(failures.is_empty(), "{} of {} handlers failed:\n{}", failures.len(), ran, failures.join("\n"));
    assert!(ran > 50, "{} handlers ran", ran);
}
