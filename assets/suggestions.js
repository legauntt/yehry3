import { currentScope } from "./page-scope.js";
// Curated locally: no model/API call is needed to suggest an idea.
export const ideas = [
  "Medusa as a midnight barbershop quartet.",
  "Ball and Chain with four close voices and no instruments.",
  "One 4 the Road as a bouncing barbershop farewell.",
  "An original synth-pop song about missing the last train home.",
  "Tony sings a disco anthem about losing one very expensive shoe.",
  "A smoky lounge song for the last customer in a roadside diner.",
  "An original punk song about a washing machine that keeps stealing socks.",
  "A slow blues confession from a retired sea monster.",
  "A country waltz about a dog who inherited the family bar.",
  "An electronic victory song for a hero who forgot why he was fighting.",
  "A gospel-inspired original about finding twenty dollars in an old coat.",
  "Tony fronts a surf-rock band at the end of the world.",
  "A piano ballad from the moon to the person who keeps photographing it.",
  "A spaghetti-western song about the last jukebox in town.",
  "A warm acoustic original about two friends repairing a terrible car.",
  "A funk song about trying to look cool while carrying too many groceries.",
  "A doo-wop original for the ghost haunting the bowling alley.",
  "An opera aria about a microwave dinner with an impossible cooking time.",
  "A rainy trip-hop song about an apology that arrives ten years late.",
  "A garage-rock original about a neighborhood feud over a plastic flamingo.",
  "A soul ballad for a bartender who remembers everybody’s first drink.",
  "A ska song about taking the wrong bus to your own wedding.",
  "A folk song told by the boots outside a stranger’s door.",
  "A dance track about a dragon with a very ordinary office job.",
  "A grand orchestral original about surviving a truly awful Tuesday.",
  "A bluegrass song about a getaway car that refuses to start.",
  "An indie-rock original about the map drawn on a diner napkin.",
  "A late-night jazz song for someone watching the city from a laundromat.",
  "A dramatic electronic song about becoming a god and missing your dog.",
  "A cheerful calypso original about a holiday that goes wrong in every way.",
  "A heavy rock song about the shoes left behind after a vanished concert.",
  "A gentle acoustic song about teaching an old rival to dance.",
  "A Motown-inspired original about falling in love at the hardware store.",
  "A sea shanty about a pirate crew with terrible navigation skills.",
  "A psychedelic rock song about a garden that grows memories.",
  "A tango told by the last two umbrellas in a lost-property office.",
  "A new-wave original about an answering machine that gives life advice.",
  "A dusty country song about the town that renamed its only street.",
  "A soul-rock anthem about showing up for a friend without being asked.",
  "A dreamy electronic original about the lights in an empty amusement park.",
  "A cabaret song about a magician whose best trick is paying the rent.",
  "An acoustic original inspired by Someday, about starting over at sixty.",
  "A new rock song inspired by Little Bit More, about refusing to leave the party.",
  "An original noir ballad inspired by Medusa, told from the statue’s perspective.",
  "A bossa nova song about the world’s least relaxing beach holiday.",
  "A distorted blues song about a vending machine that grants bad wishes.",
  "A bright pop original about finally returning a borrowed jacket.",
  "A slow country duet feel, with Tony answering his own terrible advice.",
  "A theatrical rock finale about closing the family restaurant for the last time.",
  "A tender piano original about the person who leaves the porch light on.",
];

const rotation = [...ideas];
for (let i = rotation.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [rotation[i], rotation[j]] = [rotation[j], rotation[i]];
}
rotation.length = 5;
let timer,
  index = 0,
  currentRoot;
export function rotateSuggestions(root) {
  currentRoot = root;
  clearInterval(timer);
  currentScope().onLeave(() => clearInterval(timer));
  const nodes = [...root.querySelectorAll("[data-suggestion]")];
  function update() {
    for (const node of nodes) {
      if (!node.isConnected) continue;
      if (node.matches("input, textarea")) {
        if (!node.value && document.activeElement !== node)
          node.placeholder = rotation[index];
      } else node.textContent = rotation[index];
    }
  }
  update();
  if (!nodes.length || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  timer = setInterval(() => {
    if (document.hidden) return;
    index = (index + 1) % rotation.length;
    update();
  }, 12000);
}
addEventListener("pagehide", () => clearInterval(timer));
addEventListener("pageshow", (event) => {
  if (event.persisted && currentRoot) rotateSuggestions(currentRoot);
});
