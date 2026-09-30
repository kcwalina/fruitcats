//! What one seat sees of the table, as JSON: every zone with its count, the objects the seat may see, and for the
//! others only what is public about them (their states and counters: an opponent's exhausted Offering is face down but
//! visibly exhausted). A pile the seat can't see into is only its count, since listing hidden cards in order says
//! nothing and costs a lot.

use super::state::{Game, ObjectId, Outcome, Seat};
use crate::loader::queries::string;

impl Game {
    /// The table as `seat` sees it; `None` sees everything (a judge, a replay viewer, a test).
    pub fn view_json(&self, seat: Option<Seat>) -> String {
        let sees = |object: ObjectId| seat.is_none_or(|s| self.sees(s, object));
        let mut out = format!(
            "{{\"game\":{},\"seat\":{},\"round\":{},\"turn\":{},\"actor\":{},\"outcome\":{}",
            string(&self.catalog.game),
            seat.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
            self.round,
            self.turn,
            self.actor.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
            match &self.outcome {
                None => "null".to_string(),
                Some(Outcome::Draw) => "{\"draw\":true}".to_string(),
                Some(Outcome::Winner(s)) => format!("{{\"winner\":{}}}", s),
            }
        );
        out.push_str(",\"counters\":");
        out.push_str(&map_json(self.counters.iter()));
        out.push_str(",\"flags\":");
        out.push_str(&list_json(self.flags.iter()));
        out.push_str(",\"players\":[");
        for (i, player) in self.players.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!(
                "{{\"seat\":{},\"counters\":{},\"flags\":{}}}",
                player.seat,
                map_json(player.counters.iter()),
                list_json(player.flags.iter())
            ));
        }
        out.push_str("],\"zones\":[");
        for (index, zone) in self.zones.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            let def = &self.catalog.zones[zone.def];
            out.push_str(&format!(
                "{{\"zone\":{},\"name\":{},\"owner\":{},\"count\":{}",
                string(&self.zone_label(index)),
                string(&def.name),
                zone.owner.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
                zone.objects.len()
            ));
            let any_seen = zone.objects.iter().any(|&o| sees(o));
            if def.shape == "pile" && !any_seen {
                out.push('}');
                continue;
            }
            out.push_str(",\"objects\":[");
            for (i, &object) in zone.objects.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&self.object_json(object, &sees));
            }
            out.push_str("]}");
        }
        out.push_str("]}");
        out
    }

    fn object_json(&self, object: ObjectId, sees: &dyn Fn(ObjectId) -> bool) -> String {
        let o = &self.objects[object];
        let public = format!(
            "\"states\":{},\"counters\":{},\"attachments\":[{}],\"under\":{}",
            list_json(o.states.iter()),
            map_json(o.counters.iter()),
            o.attachments.iter().map(|&a| self.object_json(a, sees)).collect::<Vec<_>>().join(","),
            o.under.len()
        );
        if !sees(object) {
            return format!("{{\"hidden\":true,{}}}", public);
        }
        let card = &self.catalog.cards[o.card];
        format!(
            "{{\"id\":{},\"card\":{},\"name\":{},\"face\":{},\"owner\":{},\"controller\":{},{}}}",
            o.id,
            string(&card.key),
            string(&card.name),
            o.face,
            o.owner.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
            o.controller.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
            public
        )
    }
}

fn map_json<'a>(items: impl Iterator<Item = (&'a String, &'a i64)>) -> String {
    format!("{{{}}}", items.map(|(k, v)| format!("{}:{}", string(k), v)).collect::<Vec<_>>().join(","))
}

fn list_json<'a>(items: impl Iterator<Item = &'a String>) -> String {
    format!("[{}]", items.map(|s| string(s)).collect::<Vec<_>>().join(","))
}
