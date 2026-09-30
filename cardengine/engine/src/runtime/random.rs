//! The game's one source of randomness: xoshiro256**, seeded through SplitMix64 from the game's seed. Its state is part
//! of the game, so a cloned or saved game draws the same numbers next, and a seed replays a game on every host.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Random {
    state: [u64; 4],
}

impl Random {
    pub fn new(seed: u64) -> Random {
        let mut mix = seed;
        let mut next = || {
            mix = mix.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = mix;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        };
        Random { state: [next(), next(), next(), next()] }
    }

    pub fn next_u64(&mut self) -> u64 {
        let s = &mut self.state;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }

    /// A number from 0 to `n - 1`, every one equally likely (Lemire's method, without its bias).
    pub fn below(&mut self, n: u64) -> u64 {
        assert!(n > 0, "below(0)");
        let threshold = n.wrapping_neg() % n;
        loop {
            let product = (self.next_u64() as u128) * (n as u128);
            if (product as u64) >= threshold {
                return (product >> 64) as u64;
            }
        }
    }

    /// Puts `items` in a random order (Fisher–Yates).
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i as u64 + 1) as usize;
            items.swap(i, j);
        }
    }

    pub fn state(&self) -> [u64; 4] {
        self.state
    }

    pub fn from_state(state: [u64; 4]) -> Random {
        Random { state }
    }
}
