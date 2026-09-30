//! The runtime's first step, the table: Hello TCG's game set up from a seed, the same way every time, with each seat
//! seeing only what it may. Setup is done here with the core's operations, as Hello TCG's setup rules will do it once
//! library rules run (docs/tcg/runtime-design.md, step 3).

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

fn new_game(seed: u64) -> Game {
    let catalog = Rc::new(Catalog::read(&hello_tcg()).unwrap());
    let setup = Setup { seats: vec![SeatSetup { deck: "hearth".to_string(), ..Default::default() }, SeatSetup { deck: "threshold".to_string(), ..Default::default() }], seed };
    Game::new(catalog, &setup).unwrap()
}

/// Hello TCG's setup (hello-tcg.alex, `setup`): the Hero starts in the Hearth, the deck is shuffled, and each player
/// draws their opening hand of 3.
fn set_up(game: &mut Game) {
    for seat in 0..game.players.len() {
        let deck = game.zone_named("Deck", Some(seat)).unwrap();
        game.cause = Some("StartsInZone (rulebook: setup)".to_string());
        let hero = game.zones[deck].objects.iter().copied().find(|&o| game.catalog.cards[game.objects[o].card].types.iter().any(|t| t == "Hero")).unwrap();
        let hearth = game.zone_named("Hearth", Some(seat)).unwrap();
        game.move_to(hero, hearth, Position::Top).unwrap();
        game.cause = Some("ShuffleDeck (rulebook: setup)".to_string());
        game.shuffle(deck);
        game.cause = Some("OpeningHand (rulebook: setup)".to_string());
        let hand = game.zone_named("Hand", Some(seat)).unwrap();
        for _ in 0..3 {
            let top = game.zones[deck].objects[0];
            game.move_to(top, hand, Position::Bottom).unwrap();
        }
    }
    game.cause = None;
}

#[test]
fn the_catalog_has_hello_tcgs_zones_cards_and_decks() {
    let catalog = Catalog::read(&hello_tcg()).unwrap();
    assert_eq!(catalog.game, "hello-tcg");
    let zones: Vec<&str> = catalog.zones.iter().map(|z| z.name.as_str()).collect();
    assert_eq!(zones, ["Deck", "Hand", "Board", "Discard", "Hearth"]);
    assert_eq!(catalog.zones[catalog.zone("Hearth").unwrap()].shape, "slot");
    assert_eq!(catalog.zone_with_role("deck"), catalog.zone("Deck"));
    let hearth = &catalog.decks[catalog.deck("hearth").unwrap()];
    assert_eq!(catalog.cards[hearth.hero.unwrap()].key, "dziadzius");
    assert_eq!(hearth.cards.iter().map(|&(_, n)| n).sum::<u32>(), 12);
    assert_eq!(catalog.cards[catalog.card("klobuk").unwrap()].types[0], "Creature");
}

#[test]
fn a_new_game_puts_each_deck_in_its_players_deck_zone() {
    let game = new_game(1);
    for seat in 0..2 {
        let deck = game.zone_named("Deck", Some(seat)).unwrap();
        assert_eq!(game.zones[deck].objects.len(), 13, "12 cards and the Hero");
        assert!(game.zones[deck].objects.iter().all(|&o| game.objects[o].owner == Some(seat)));
    }
    assert_eq!(game.log.len(), 1);
    assert!(game.log_json(None, 0).contains("\"event\":\"game-started\""));
}

#[test]
fn the_same_seed_sets_up_the_same_table_and_the_same_log() {
    let (mut a, mut b) = (new_game(42), new_game(42));
    set_up(&mut a);
    set_up(&mut b);
    assert_eq!(a.view_json(None), b.view_json(None));
    assert_eq!(a.log_json(None, 0), b.log_json(None, 0));

    let hands = |seed: u64| {
        let mut game = new_game(seed);
        set_up(&mut game);
        let hand = game.zone_named("Hand", Some(0)).unwrap();
        game.zones[hand].objects.iter().map(|&o| game.card_key(o).to_string()).collect::<Vec<_>>()
    };
    let different = (1..20).filter(|&seed| hands(seed) != hands(42)).count();
    assert!(different > 10, "other seeds deal other hands");
}

#[test]
fn a_player_sees_their_own_hand_and_only_counts_of_the_rest() {
    let mut game = new_game(7);
    set_up(&mut game);
    let view: String = game.view_json(Some(0));
    let hand0 = game.zone_named("Hand", Some(0)).unwrap();
    for &o in &game.zones[hand0].objects {
        assert!(view.contains(&format!("\"id\":{},\"card\":\"{}\"", o, game.card_key(o))), "seat 0 sees its own hand");
    }
    let hand1 = game.zone_named("Hand", Some(1)).unwrap();
    for &o in &game.zones[hand1].objects {
        assert!(!view.contains(&format!("\"id\":{},", o)), "seat 0 doesn't see seat 1's hand");
    }
    assert!(view.contains("{\"zone\":\"Deck/0\",\"name\":\"Deck\",\"owner\":0,\"count\":9}"), "a deck is only its count: {}", view);
    assert!(view.contains("\"card\":\"dziadzius\""), "both Heroes are in view, face up in the Hearth");
}

#[test]
fn a_players_log_hides_the_cards_the_opponent_draws() {
    let mut game = new_game(7);
    set_up(&mut game);
    let log0 = game.log_json(Some(0), 0);
    let draws = |log: &str, zone: &str| log.lines().filter(|l| l.contains(&format!("\"to\":\"{}\"", zone))).map(str::to_string).collect::<Vec<_>>();
    let own = draws(&log0, "Hand/0");
    let theirs = draws(&log0, "Hand/1");
    assert_eq!((own.len(), theirs.len()), (3, 3));
    assert!(own.iter().all(|l| l.contains("\"card\":")));
    assert!(theirs.iter().all(|l| l.contains("{\"hidden\":true}") && !l.contains("\"id\"")));
    assert!(theirs.iter().all(|l| l.contains("\"cause\":\"OpeningHand (rulebook: setup)\"")));
    assert!(log0.contains("\"event\":\"shuffled\",\"zone\":\"Deck/1\""), "a shuffle is logged, never its order");
}

#[test]
fn a_clone_is_a_game_of_its_own() {
    let mut game = new_game(3);
    set_up(&mut game);
    let before = game.view_json(None);
    let mut copy = game.clone();
    let deck = copy.zone_named("Deck", Some(0)).unwrap();
    copy.shuffle(deck);
    let top = copy.zones[deck].objects[0];
    copy.set_state(top, "exhausted", true).unwrap();
    assert_eq!(game.view_json(None), before);
    assert_ne!(copy.view_json(None), before);
}

#[test]
fn a_revealed_card_is_seen_until_it_moves() {
    let mut game = new_game(5);
    set_up(&mut game);
    let hand1 = game.zone_named("Hand", Some(1)).unwrap();
    let card = game.zones[hand1].objects[0];
    assert!(!game.sees(0, card));
    game.reveal(card, &[0]).unwrap();
    assert!(game.sees(0, card));
    let discard = game.zone_named("Deck", Some(1)).unwrap();
    game.move_to(card, discard, Position::Bottom).unwrap();
    assert!(!game.sees(0, card));
}

#[test]
fn random_numbers_are_even_and_repeatable() {
    use kardix::runtime::random::Random;
    let mut counts = [0u32; 6];
    let mut random = Random::new(99);
    for _ in 0..60_000 {
        counts[random.below(6) as usize] += 1;
    }
    assert!(counts.iter().all(|&c| (9_000..11_000).contains(&c)), "{:?}", counts);
    let (mut a, mut b) = (Random::new(5), Random::new(5));
    assert!((0..100).all(|_| a.next_u64() == b.next_u64()));
}
