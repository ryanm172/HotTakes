# Hot Takes

## Goal

Practice building a small project with AI. The first playable build must support real online rooms across separate iPhones through a mobile web app. Development equipment: Windows PC and iPhone. Selected stack: React, TypeScript, Vite, and Supabase. Keep the initial build local; include hosting instructions.

## Experience

A playful, fiery game-show style with warm colors and bold typography. Built-in opinion prompts include edgier debates such as celebrity attractiveness. Pick prompts randomly without repeats within a game.

## Rooms

- 4–8 players; host starts the game from the lobby.
- Join with a nickname and room code, without accounts.
- Save player identity on the phone for reconnection.
- New players may join only before the game starts.
- Transfer host controls to a connected player after the host disconnects for 30 seconds.
- Pause between rounds if fewer than four players are connected.

## Round flow

1. Show the same prompt to all players.
2. Allow 60 seconds to submit an answer, ending early when everyone submits. Answers lock immediately on submission.
3. A missing answer earns zero points; its player can still vote. With fewer than three submitted answers, skip without consuming a scored round and select a new prompt.
4. Show anonymous answers in a shuffled order for each voter. Keep duplicate answers as separate cards; they can receive different scores.
5. Players drag all other players’ answers from hottest to coldest and explicitly submit. Hottest means most controversial or surprising, rather than most popular. Players cannot rank their own answer.
6. Votes lock on submission and remain private until results. There is no voting timer. Wait for every original voter, including disconnected voters. The host cannot waive a vote; a player who never returns can stall the game indefinitely.
7. Reveal authors, heat order, points earned, and total scores. The host advances to the next round.

## Ranking and points

For a ballot containing k answers, the answer at position r receives heat 100 × (k − r) / (k − 1), where r starts at 1. Average each answer’s heat across ballots containing it. Sort by highest average heat first. This makes ballots comparable when players who did not answer rank an extra card.

With n submitted answers, award points by heat order: 0, n−1, n−2, …, 1. For six answers, this is 0, 5, 4, 3, 2, 1.

Tied answers share the average points of the places they occupy, including ties for hottest. For example, a tie across first and second among six answers gives each 2.5 points. Use exact scores for ties and totals; display rounding must not affect outcomes.

## Game end

After five scored rounds, the highest total wins. Players tied for the highest total share the win.

## Implementation planning

Test in Safari on iPhone over the local Wi-Fi network and use separate desktop browser profiles to simulate additional players. Supabase owns phase transitions, answer deadlines, private submissions, and scoring. Start with periodic server synchronization for this turn-based game. Cloud configuration and a live multi-device test remain required before calling real online play verified.

This brief records the agreed product behavior; it does not authorize publishing, paid services, or App Store submission.
