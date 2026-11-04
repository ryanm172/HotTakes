# Hot Takes

## Goal

Practice building a small project with AI. The first playable build must support real online rooms across separate iPhones through a mobile web app. Development equipment: Windows PC and iPhone. Selected stack: React, TypeScript, Vite, and Supabase. Keep the initial build local; include hosting instructions.

## Experience

A playful, fiery game-show style with warm colors and bold typography. Built-in opinion prompts include edgier debates such as celebrity attractiveness. Pick prompts randomly without repeats within a game.

## Rooms

- 4–8 players; host starts the game from the lobby.
- Join with a nickname and room code, without accounts.
- Choose a mascot badge beside the nickname before hosting or joining. The eight
  choices are Hot Wings, Hot Breath (a fire-breathing dragon), Hot Honey, Hot Sun,
  Hot Sauce, Hot Pepper, Hot Coffee, and Hot Potato. All have expressive faces,
  bold outlines, warm colors, and cream circular backgrounds.
- Default to Hot Sauce, allow duplicates, and remember the choice on that browser.
  Tapping the badge preview opens eight labeled options; tapping an option saves
  immediately. Players can reopen the picker from their own lobby avatar.
- Badges lock when the game starts. If the game starts with a picker open or a save
  pending, close the picker and retain the last server-approved badge. Failed saves
  leave the previous badge selected and allow retry.
- Show badges beside named players, including revealed answer authors, the final
  scoreboard, winners, and recap authors. Never attach badges to anonymous answers.
  Practice uses the selected badge and fixed badges for simulated players.
- Save player identity on the phone for reconnection.
- New players may join only before the game starts.
- Transfer host controls to a connected player after the host disconnects for 30 seconds.
- Pause between rounds if fewer than four players are connected.
- Explicit lobby departures free the nickname and slot immediately. Delete empty lobbies;
  if the host explicitly leaves and nobody else is connected, close the lobby.
- Remove lobby members after ten minutes without contact. They may join again before
  the game starts, subject to nickname availability and capacity.
- Leaving an unfinished game requires confirmation. Keep the player's slot, submissions,
  and score, mark them offline immediately, and transfer hosting to a connected player.
  Leaving is synchronized across browser tabs sharing the player identity.
- Offer Return to game (or View last results for finished games) until joining/creating
  another room or discovering the old room has expired. Room-code reentry also works.
- Reject access after one hour without successful member activity (including polling).
  Finished games use the same retention. Run cleanup every five minutes to delete
  expired rooms and prune absent lobby members. Active-game membership is preserved.
- A failed Leave offers retry or a local exit, which cannot guarantee server departure.

## Round flow

1. Show the same prompt to all players.
2. Allow 60 seconds to submit an answer, ending early when everyone submits. Answers lock immediately on submission.
3. A missing answer earns zero points; its player can still vote. With fewer than three submitted answers, skip without consuming a scored round and select a new prompt.
4. Show anonymous answers in a shuffled order for each voter. Keep duplicate answers as separate cards; they can receive different scores.
5. Players drag all other players’ answers from hottest to coldest and explicitly submit. Hottest means most controversial or surprising, rather than most popular. Players cannot rank their own answer.
6. Votes lock on submission and remain private until results. There is no voting timer. Wait for every original voter, including disconnected voters. The host cannot waive a vote; a player who never returns can stall the game indefinitely.
7. Resolve any qualifying highest-heat tie through Hot Seat before awarding points.
   Then reveal authors, heat order, points earned, and total scores. The host advances.

## Ranking and points

For a ballot containing k answers, the answer at position r receives heat 100 × (k − r) / (k − 1), where r starts at 1. Average each answer’s heat across ballots containing it. Sort by highest average heat first. This makes ballots comparable when players who did not answer rank an extra card.

With n submitted answers, award points by heat order: 0, n−1, n−2, …, 1. For six answers, this is 0, 5, 4, 3, 2, 1.

Ties below the highest heat share the average points of their occupied places.
Use exact scores for ties and totals; display rounding must not affect outcomes.

### Hot Seat

- An exact tie for highest heat triggers Hot Seat if at least one original player
  is outside that tie to judge. If everyone is a contestant, skip it, explain why,
  and use the normal equal split. Missing-answer players can be outside judges.
- Reveal the tied players, badges, answers, and point pool. Randomize speaking order
  once and save it. All round points remain provisional until the verdict.
- The host starts each contestant's separate 60-second turn. Show their name and
  badge, answer, countdown, and "Explain your case!". Speaking happens in person;
  there is no recording or voice chat. Only that speaker can tap "I'm done" early.
- After each speech, the host starts the next speaker. After the last, open voting.
  Server deadlines continue if the speaker disconnects; their turn is not skipped.
  Host transfer works normally, without restarting speeches or reshuffling the order.
- Only outside judges vote. Each selects one best defense, then explicitly submits.
  Votes lock immediately. Show submission status but keep choices/counts private
  until all judges vote, including disconnected judges. No timer or host override.
- The tied group's occupied positions supply the point pool. Contestants with the
  lowest vote count get zero; all others split that pool equally. If all counts are
  equal, every contestant shares it. Other players keep their normal round points.
  Example: a three-way tie among six answers has a 0+5+4=9 point pool; votes 1–0–0
  award 9–0–0, votes 2–1–0 award 4.5–4.5–0, and votes 1–1–1 award 3–3–3.
- Reveal defense vote counts and final points together. Lowest-vote answers become
  the recap's hottest takes; if counts are equal, keep all tied contestants.
- Round five also completes Hot Seat before final results and View game recap.
  Practice follows the same flow, with labeled simulated judges and a practice-only
  control to finish simulated speakers early. A real practice judge still votes.

## Game end

After five scored rounds, the highest total wins. Players tied for the highest total share the win.

Show round-five results first, then offer **View game recap**. The recap uses one
column without the midgame player sidebar: winner announcement, final scoreboard,
then five expanded round highlight cards in chronological order.

The scoreboard sorts all players by total points and shows rank, nickname, total,
and a "you" marker. Equal totals share a rank using competition ranking (1, 1, 3).
Each round card shows its prompt, hottest answer(s), and authors only. After Hot Seat,
use the lowest-defense-vote answers (all contestants if counts are equal); otherwise
preserve exact highest-heat ties. Do not show heat or points on the highlight cards.
Save highlights only after scoring, and retain them with the room for reconnecting
players. Practice mode follows the same flow. Back to the start and View last results
keep the existing room-retention policy. No rematch flow or recovery of old test games.

## Implementation planning

Test in Safari on iPhone over the local Wi-Fi network and use separate desktop browser profiles to simulate additional players. Supabase owns phase transitions, answer deadlines, private submissions, and scoring. Start with periodic server synchronization for this turn-based game. Cloud configuration and a live multi-device test remain required before calling real online play verified.

This brief records the agreed product behavior; it does not authorize publishing, paid services, or App Store submission.
