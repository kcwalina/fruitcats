# Vietnam prototypes: Flower-Souls (MB1) and Hui Hai (HH1)

Two prototype decks from the Vietnam research (see [folk-creatures.md](folk-creatures.md#vietnam-proposed)). On
2026-09-27 the owner picked two styles from old, public-domain paintings and asked for four prototype cards in each.
Both sets are `prototype`: they show only with `?prototypes`. Nothing is released and no engine code was written.

## Flower-Souls (MB1), content/2027/01/flower-souls

Mẻ Bjoóc (Mother Flower) of the Tày and Nùng keeps a garden in the sky where every child's soul grows as a flower,
gold for boys and silver for girls. The cards: the hero Silver Bud, the Littlest Flower-Soul (a bud that opens when
she Awakens), Mẻ Bjoóc, Mother Flower (Fabled), Golden Flower-Soul (Creature) and Tending the Roots (Charm: the Then
singer who climbs to the sky garden to tend a wandering soul's flower). They play by healing.

**Style:** the Yao (Dao) ritual painting "Chia Fin", Guangxi, 1920, Ethnological Museum Berlin: flat vermilion ground,
black outlines, figures in indigo and green, white cloud scrolls. Public domain; photo CC0 by Daderot
([Commons](https://commons.wikimedia.org/wiki/File:Chia_Fin_-_Guangxi_province,_China,_1920_-_Ethnological_Museum,_Berlin_-_DSC01315.JPG)).
Tày Then and Tào priests use the same painted pantheon.

**Care:** Then is a living practice (UNESCO, 2019), and the belief touches children's illness: keep the deck about
the garden, not about sickness.

## Hui Hai (HH1), content/2027/01/hui-hai

Tiny, invisible, very strong forest folk of the Ba Na (Bahnar) of the Central Highlands, who throw stones at people who
behave badly in the forest. The cards: the hero Pebble, the Littlest Hui Hai, Hui Hai of the Stream (Creature), Yă Hui
Hai, Lady of the Ferns (Fabled) and A Pebble at Your Feet (Charm). They play by small, sudden damage.

**Style:** the Hàng Trống folk painting "White Tiger" (Bạch hổ), Hanoi, a traditional design: cobalt ground,
many-coloured swirling clouds, fine parallel brush strokes. Public domain
([Commons](https://commons.wikimedia.org/wiki/File:White_tiger_Hang_Trong.jpg)).

**Care:** the Hui Hai rest on one source (Trần et al., on Bahnar forest animism, citing Guilleminet's Bahnar–French
dictionary); check it before a full deck. They are drawn as tiny spirits in leaf clothes, never as a picture of the
Ba Na people.

## Art

Drawn with `python tools/generate_art.py --set mb1|hh1 --model gpt-image-2 --quality high --jobs 1 --reference <the
painting>`. The reference images are the Commons files above, cropped to the painting. Both styles are the old
paintings' own, not a living artist's.
