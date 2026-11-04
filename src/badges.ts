export const badges = [
  {id:'hot-wings',name:'Hot Wings'}, {id:'hot-breath',name:'Hot Breath'},
  {id:'hot-honey',name:'Hot Honey'}, {id:'hot-sun',name:'Hot Sun'},
  {id:'hot-sauce',name:'Hot Sauce'}, {id:'hot-pepper',name:'Hot Pepper'},
  {id:'hot-coffee',name:'Hot Coffee'}, {id:'hot-potato',name:'Hot Potato'},
] as const;
export type BadgeId = typeof badges[number]['id'];
export const defaultBadge:BadgeId='hot-sauce';
export function validBadge(value:unknown):BadgeId {
  return badges.find(b=>b.id===value)?.id || defaultBadge;
}
