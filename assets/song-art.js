// Original vector clip art: titles choose the possible cast; recording IDs pick
// the character, colors, backdrop, expression, pose, and props. Loved songs leave
// the regular cast for award mascots on their own stages. Compact API and offline
// songs get the same base art; vote art needs the live counts.
const palettes = [
  ["#f6dfb5", "#e78c61", "#739c91"], ["#dbe7d4", "#86aa80", "#edb865"],
  ["#eadff1", "#ae91bf", "#f2b477"], ["#dbe9ef", "#7fa8c3", "#e79e89"],
  ["#f3dce0", "#df93a5", "#96b9aa"], ["#f2ebbc", "#d7b45d", "#98afc7"],
  ["#d9ead3", "#5fa89a", "#f08a5d"], ["#fde2c8", "#f2a65a", "#6d8fb3"],
  ["#e3e4f7", "#8a8fd1", "#f0c05a"], ["#d3eef0", "#4fb0b8", "#f29e9e"],
  ["#f5e6cc", "#c98f6b", "#7fb285"], ["#ece0d1", "#b8886a", "#89b0ae"],
];
const ink = "#303f38", paper = "#fffaf0", rose = "#e8557c", gold = "#f7c948";
const path = (d, fill = "none") => '<path d="' + d + '" fill="' + fill + '"/>';
const circle = (x, y, r, fill) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"/>';
const rect = (x, y, w, h, r, fill) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + fill + '"/>';
const ellipse = (x, y, rx, ry, fill) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"/>';
const miniHeart = "M10 18L3 10C-2 3 6 -2 10 4C14 -2 22 3 17 10Z";
const point = (cx, cy, r, degrees) => (cx + r * Math.cos(degrees * Math.PI / 180)).toFixed(1) + " " + (cy + r * Math.sin(degrees * Math.PI / 180)).toFixed(1);
// Stars, rosette edges, and sparkles are all the same zigzag ring.
function burst(cx, cy, outer, inner, points, fill) {
  let d = "";
  for (let i = 0; i < points * 2; i++) d += (i ? "L" : "M") + point(cx, cy, i % 2 ? inner : outer, -90 + i * 180 / points);
  return path(d + "Z", fill);
}
function rays(cx, cy, count, fill, opacity) {
  let d = "";
  for (let i = 0; i < count; i++) d += "M" + cx + " " + cy + "L" + point(cx, cy, 260, i * 360 / count) + "L" + point(cx, cy, 260, (i + .5) * 360 / count) + "Z";
  return '<path d="' + d + '" fill="' + fill + '" opacity="' + opacity + '"/>';
}

// Each drawing shares a chunky pen outline and a deliberately daft little face.
const drawings = {
  shoe: (a, b) => path("M54 63L92 58 101 103Q115 118 148 121Q162 124 163 143L43 143 44 110Z", a) + path("M43 143H164V154H43Z", paper) + path("M82 87L99 83M88 99L106 96M99 112L115 106") + circle(66, 84, 8, b),
  burger: (a, b) => path("M43 91Q46 46 100 46Q153 46 158 91Z", a) + rect(41, 101, 118, 17, 8, "#875c46") + path("M43 95L61 103 80 95 99 103 121 95 143 103 157 95", b) + path("M43 127H158Q155 151 135 153H66Q47 151 43 127Z", a) + path("M66 70L72 66M96 61L102 64M125 71L130 67"),
  book: (a, b) => path("M41 53Q72 40 100 56Q130 40 159 53V142Q128 130 100 146Q70 130 41 142Z", a) + path("M100 57V145M53 69L79 65M122 65L147 69M53 124L77 121M124 121L147 124") + path("M127 48V82L137 75 147 83V49", b),
  mustache: (a) => circle(100, 99, 52, paper) + path("M99 111Q82 91 67 116Q55 128 45 114Q47 150 82 142Q96 140 100 126Q105 143 127 143Q154 142 157 114Q144 129 133 115Q118 94 100 111Z", a) + path("M72 65L87 68M114 68L128 64"),
  envelope: (a, b) => rect(41, 62, 120, 83, 8, a) + path("M44 67L100 113 158 67M44 142L78 110M158 142L123 110") + rect(133, 73, 17, 21, 2, b),
  train: (a, b) => rect(59, 42, 82, 106, 15, a) + rect(69, 58, 62, 39, 7, paper) + circle(76, 130, 9, b) + circle(124, 130, 9, b) + path("M74 149L56 171M126 149L145 171M66 160H135M80 34H120"),
  toast: (a, b) => path("M58 84Q33 67 52 47Q74 29 101 43Q126 28 148 48Q166 68 143 84V149H58Z", a) + rect(69, 83, 62, 52, 15, b) + path("M76 55L82 53M122 58L127 61"),
  ghost: (a, b) => path("M51 148V89Q50 41 99 41Q149 41 149 91V153L131 141 115 155 98 142 80 155 65 141Z", paper) + path("M59 67Q77 37 111 48", a) + path("M144 95Q175 85 165 113L148 124", b),
  clock: (a, b) => circle(100, 98, 54, a) + circle(100, 98, 42, paper) + path("M100 64V93L122 82M73 47L57 32M128 47L145 32M68 145L57 160M132 145L144 160") + path("M45 43Q48 23 67 26M133 26Q154 23 155 43", b),
  moon: (a, b) => path("M122 40Q65 33 49 82Q30 144 98 158Q133 163 159 131Q104 143 93 96Q86 62 122 40Z", a) + circle(66, 89, 8, b) + circle(83, 139, 5, b),
  heart: (a) => path("M100 157L51 107C8 58 68 21 100 61C132 21 192 58 149 107Z", a),
  crown: (a, b) => path("M52 133L37 58 78 89 100 41 124 89 165 57 148 133Z", a) + rect(51, 132, 98, 20, 5, b) + circle(100, 39, 6, paper) + circle(35, 55, 6, paper) + circle(167, 55, 6, paper),
  leaf: (a, b) => path("M48 140Q29 58 150 39Q172 142 48 140Z", a) + path("M43 161L127 68M79 119L68 83M105 95L131 98") + circle(146, 46, 5, b),
  chair: (a, b) => rect(54, 48, 91, 66, 13, a) + rect(48, 124, 106, 18, 6, b) + path("M63 114V126M138 114V126M59 144L54 167M143 144L150 166M46 100H28V127H49M151 100H172V127H153"),
  bulb: (a, b) => path("M77 137C74 118 47 111 49 82C50 23 149 23 152 81C154 111 126 119 123 137Z", a) + rect(77, 137, 46, 19, 5, b) + path("M83 161H117M100 16V6M40 36L30 25M165 40L178 30M175 84H188M21 84H32"),
  road: (a, b) => path("M80 45H119L160 158H39Z", a) + path("M99 50V64M99 77V89M99 132V146", paper) + path("M144 51H173L180 62 172 73H144Z", b) + path("M157 75V120"),
  flag: (a, b) => path("M54 171V38M57 46Q84 29 113 48Q134 61 159 44V118Q134 134 108 115Q82 100 58 118", a) + circle(53, 30, 8, b),
  bird: (a, b) => path("M60 137Q31 89 73 76Q68 37 106 45Q136 51 128 81Q158 102 139 135Q99 163 60 137Z", a) + path("M78 110Q96 94 117 108Q107 138 82 133Z", b) + path("M125 66L153 76 125 82", b) + path("M79 145V163H65M118 145V163H132"),
  tower: (a, b) => rect(45, 46, 49, 108, 3, a) + rect(110, 34, 45, 121, 3, b) + path("M57 64H66M77 64H83M57 83H66M124 53H134M124 73H144M122 141H143M57 140H79"),
  phone: (a, b) => rect(50, 81, 100, 69, 18, a) + path("M43 88Q26 45 68 40L77 67 62 80M157 88Q174 45 132 40L123 67 138 80M69 43Q101 32 132 43", b) + path("M148 140Q174 136 172 151Q169 169 146 165"),
  key: (a, b) => circle(78, 80, 34, a) + circle(77, 76, 12, paper) + path("M97 105L141 151 158 135 145 123 135 134 124 122 134 111 123 100 112 110Z", b),
  robot: (a, b) => rect(49, 60, 102, 81, 15, a) + rect(66, 79, 67, 41, 9, paper) + path("M100 58V40M39 78V119M161 78V119M72 141V156M129 141V156") + circle(100, 32, 9, b),
  sun: (a, b) => path("M100 20V8M100 179V192M20 100H8M178 100H193M41 41L29 29M158 158L170 170M41 158L29 170M158 41L170 29") + circle(100, 100, 58, a) + circle(66, 123, 7, b) + circle(134, 123, 7, b),
  bee: (a, b) => path("M86 63Q45 18 45 59Q43 85 80 90M114 64Q153 18 155 59Q156 85 120 90", paper) + '<ellipse cx="100" cy="109" rx="48" ry="41" fill="' + a + '"/>' + path("M72 78Q61 111 77 142M125 77Q141 111 124 143") + path("M83 73L74 56M117 73L128 56M146 108L164 116 145 122", b),
  sword: (a, b) => path("M99 29L121 57 116 121H84L79 57Z", paper) + path("M100 50V86") + rect(63, 120, 73, 15, 5, a) + rect(88, 135, 24, 33, 4, b),
  save: (a, b) => path("M49 44H135L155 64V156H47V44Z", a) + rect(70, 44, 56, 36, 2, paper) + rect(77, 130, 45, 26, 2, b) + path("M114 53V69"),
  tent: (a, b) => path("M39 82L100 35 160 82Z", a) + path("M45 83L34 154H166L155 83Z", paper) + path("M60 84L54 153H79L83 84M119 84L123 153H148L140 84", b) + path("M100 35V15L125 22 100 29", b),
  pocket: (a, b) => path("M50 65H151V130L100 164 50 130Z", a) + path("M60 78H141V123L100 150 60 123Z") + path("M72 65L65 36 87 42 99 22 113 46 138 39 129 65", b),
  mountain: (a, b) => path("M26 155L84 43 115 91 137 66 179 155Z", a) + path("M62 83L84 43 113 91 94 83 82 95 75 80Z", paper) + path("M119 105L137 66 155 105 140 98 135 109Z", b),
  chain: (a, b) => circle(92, 112, 43, a) + path("M127 83L138 70M149 60L162 47") + '<ellipse cx="143" cy="66" rx="12" ry="20" transform="rotate(40 143 66)" fill="' + b + '"/>' + path("M156 49L170 34"),
  bandage: (a, b) => rect(35, 67, 131, 73, 28, a) + rect(70, 74, 61, 59, 9, b) + circle(50, 88, 2, ink) + circle(50, 117, 2, ink) + circle(151, 88, 2, ink) + circle(151, 117, 2, ink),
  planet: (a, b) => circle(100, 101, 50, a) + path("M55 82C-7 147 139 161 162 97C170 79 151 71 146 76M49 106Q35 134 90 135Q150 132 159 113", b) + circle(79, 64, 7, b),
  trophy: (a, b) => path("M58 54H143L134 108Q127 131 99 131Q73 131 66 107Z", a) + path("M58 61H35Q28 102 64 108M143 61H167Q175 102 138 108M100 132V153") + rect(70, 153, 60, 13, 3, b),
  donut: (a, b) => circle(100, 100, 58, a) + path("M48 77Q62 35 95 45Q135 32 153 72L148 88 133 80 122 87 111 77 94 86 77 76 62 86Z", b) + circle(100, 106, 20, paper) + path("M71 57L75 62M97 53L102 57M125 57L120 63M55 104L61 107M135 124L141 121"),
  wizard: (a, b) => path("M44 94L90 27 114 37 139 95Z", a) + path("M42 96Q97 81 159 101Q163 112 143 114H48Q31 109 42 96Z", b) + path("M60 117Q56 148 99 169Q144 148 140 117Z", paper) + circle(100, 66, 8, b),
  snake: (a, b) => path("M58 151Q19 108 66 87Q126 58 144 87Q160 117 119 128Q78 139 83 108Q84 95 106 100", a) + path("M123 74Q108 38 143 37Q173 38 168 65L151 85Z", b) + path("M167 50L185 44M177 47L185 54") + circle(149, 50, 4, paper),
  well: (a, b) => rect(51, 103, 98, 49, 6, a) + path("M54 102V60M146 103V60M36 61L99 31 165 61Z", b) + path("M100 63V90M53 127H147M76 106V126M118 128V148"),
  receipt: (a, b) => path("M59 40L72 48 85 40 98 48 111 40 124 48 139 40V163L124 155 111 163 98 155 85 163 72 155 59 163Z", paper) + path("M76 63H122M76 76H106M77 140H121", a) + circle(136, 44, 9, b),
  radio: (a, b) => rect(35, 65, 130, 85, 12, a) + path("M134 65L159 24M59 59V47H125V59") + circle(70, 107, 25, b) + rect(108, 80, 43, 21, 4, paper) + circle(120, 126, 7, paper) + circle(142, 126, 7, paper),
  washer: (a, b) => rect(50, 39, 100, 123, 10, a) + circle(100, 112, 35, paper) + path("M71 116Q85 102 100 117Q119 131 131 115L126 137Q97 154 75 135Z", b) + path("M52 69H148M66 54H89") + circle(132, 55, 5, b),
  car: (a, b) => path("M39 105L59 65H134L158 105V143H39Z", a) + path("M68 75H127L140 103H56Z", paper) + circle(61, 148, 14, ink) + circle(139, 148, 14, ink) + circle(54, 119, 7, b) + circle(144, 119, 7, b),
  bolt: (a) => path("M102 26L52 110H89L77 174 151 81H111L130 26Z", a),
  microphone: (a, b) => rect(64, 31, 73, 96, 32, a) + path("M52 91V106Q50 140 99 140Q149 140 149 106V91M100 141V164M79 168H123M80 48H120M80 61H120", b),
  record: (a, b) => circle(100, 100, 61, a) + circle(100, 100, 45, b) + circle(100, 100, 30, paper) + path("M57 84Q62 64 82 58M140 120Q133 137 117 142"),
  // Remix and style words bring in the band, so one title's versions stop sharing a cover.
  guitar: (a, b) => rect(92, 20, 16, 44, 2, b) + rect(87, 6, 26, 18, 5, a) + path("M96 26V58M104 26V58") + path("M100 58Q68 58 70 84Q72 96 62 108Q48 128 62 148Q76 166 100 166Q124 166 138 148Q152 128 138 108Q128 96 130 84Q132 58 100 58Z", a) + rect(84, 146, 32, 8, 3, b),
  trumpet: (a, b) => path("M126 84Q152 80 174 50V158Q152 130 126 128Z", b) + rect(36, 80, 94, 56, 18, a) + rect(60, 54, 13, 28, 4, b) + rect(81, 48, 13, 34, 4, b) + rect(102, 54, 13, 28, 4, b) + path("M36 108H20M20 97V119M58 52H75M79 46H96M100 52H117"),
  cassette: (a, b) => rect(34, 54, 132, 96, 10, a) + rect(48, 66, 104, 56, 6, paper) + path("M58 78H142") + path("M66 150L74 130H126L134 150Z", b) + circle(44, 140, 3, ink) + circle(156, 140, 3, ink),
  discoball: (a, b) => path("M100 50V22") + rect(88, 12, 24, 11, 3, b) + circle(100, 104, 54, a) + path("M46 104H154M53 78H147M53 130H147M100 50V158M76 56Q60 104 76 152M124 56Q140 104 124 152") + burst(164, 52, 15, 5, 4, b) + burst(34, 148, 11, 4, 4, b),
  drum: (a, b) => path("M58 28L96 70M142 28L104 70") + circle(56, 26, 6, b) + circle(144, 26, 6, b) + path("M42 78V138Q42 158 100 158Q158 158 158 138V78Z", a) + ellipse(100, 78, 58, 18, paper) + path("M42 138Q42 146 56 151M158 138Q158 146 144 151", b),
  note: (a, b) => path("M136 112V28") + path("M136 28Q172 40 165 80Q156 60 136 58Z", b) + '<ellipse cx="95" cy="120" rx="47" ry="37" transform="rotate(-14 95 120)" fill="' + a + '"/>',
  // Award mascots appear only once listeners have voted for a song.
  rosette: (a, b) => path("M80 138L66 180 86 170 98 184 104 144ZM120 138L134 180 114 170 102 184 96 144Z", b) + burst(100, 102, 63, 53, 16, a) + circle(100, 102, 44, paper),
  balloon: (a, b) => path("M100 160Q88 172 102 182Q112 190 100 198") + path("M92 162L100 150 108 162Z", a) + ellipse(100, 92, 52, 60, a) + path("M64 72Q68 50 86 44", paper) + burst(158, 40, 12, 4, 4, b),
  foamfinger: (a, b) => path("M60 160V98Q60 84 74 84H84V30Q84 16 97 16Q110 16 110 30V84H128Q144 84 144 100V160Z", a) + rect(54, 152, 96, 18, 6, b) + path("M118 84V70M132 86V76"),
  medal: (a, b) => path("M66 16L100 80 134 16H110L100 36 90 16Z", b) + circle(100, 112, 52, a) + circle(100, 112, 42, "none") + burst(100, 72, 9, 4, 5, paper),
  megaphone: (a, b) => path("M70 126V160H92V134", b) + path("M38 84L134 44V162L38 122Z", a) + rect(22, 86, 20, 34, 6, b) + path("M134 44Q162 103 134 162Q146 103 134 44Z", b) + path("M170 72L186 60M176 103H194M170 134L186 146"),
  goldrecord: (a, b) => rect(34, 40, 132, 132, 7, b) + rect(45, 51, 110, 110, 3, paper) + circle(100, 106, 48, a) + circle(100, 106, 37, "none") + path("M64 92Q70 72 90 64M136 122Q130 140 112 146"),
  rocket: (a, b) => path("M78 138Q100 204 122 138Z", b) + path("M64 104L36 150 68 140ZM136 104L164 150 132 140Z", b) + path("M100 10Q142 52 136 142H64Q58 52 100 10Z", a) + path("M79 44Q100 34 121 44"),
  superstar: (a, b) => burst(100, 116, 76, 39, 5, a) + path("M81 58L76 32 90 44 100 23 110 44 124 32 119 58Z", b),
  gem: (a, b) => path("M58 40H142L174 80 100 174 26 80Z", a) + path("M26 80H174M58 40L80 80 100 40 120 80 142 40") + burst(168, 36, 13, 4, 4, b) + burst(30, 140, 10, 3, 4, b),
};

const themes = [
  ["snake", /\b(medusa|snake)\b/i, "a snake trying to untangle its dance moves"],
  ["shoe", /\b(shoes?|pair)\b/i, "a sneaker with a very big personality"],
  ["burger", /\b(arby'?s|burger|sandwich|hunger)\b/i, "a burger ready for its big solo"],
  ["book", /\b(book|names?|truth|know)\b/i, "a book with a lot to sing about"],
  ["mustache", /\b(mustache|403)\b/i, "a mustache that has escaped its face"],
  ["envelope", /\b(envelope|letter|mail)\b/i, "a letter dancing out of the mailbox"],
  ["save", /\b(save|file|rollback|error)\b/i, "a floppy disk enjoying its comeback"],
  ["train", /\b(platform|train|express|station)\b/i, "a train on its way to band practice"],
  ["tent", /\b(carnival|circus|big top)\b/i, "a circus tent doing a little jig"],
  ["toast", /\b(unleavened|unleaved|bread)\b/i, "a piece of toast with stage presence"],
  ["tower", /\b(towers?|9[ -]?11|nine[ -]eleven)\b/i, "two wobbly buildings with dancing feet"],
  ["ghost", /\b(ghost|zombie|fear|dark|deadman|kill)\b/i, "a bashful ghost trying to look spooky"],
  ["crown", /\b(crown|reign|king|queen|campaign|wandaful)\b/i, "a crown with a questionable sense of balance"],
  ["wizard", /\b(magic|miracle|saints?|prophet|christmas|someday)\b/i, "a tiny wizard with an oversized hat"],
  ["shoe", /\b(running|movin|fast)\b/i, "a sneaker running late for its own song"],
  ["heart", /\b(heart|beloved|girl|friend|defend|defiled|raped|epstein)\b/i, "a heart with its dancing shoes on"],
  ["sun", /\b(morning|daybreak|sol|sun|day)\b/i, "a sun that overslept its alarm"],
  ["chair", /\b(bench|stools?|table|rooms?|hallway|walls)\b/i, "a chair taking itself for a walk"],
  ["car", /\b(rearview|rims|chrome|parking|meter)\b/i, "a little car honking along to the chorus"],
  ["bulb", /\b(lights?|porchlight|spark|floodlights)\b/i, "a light bulb having a bright idea"],
  ["moon", /\b(midnight|night)\b/i, "a moon staying up past its bedtime"],
  ["leaf", /\b(leaves|leaf|winters?|cold|rain|weather|smoke|ash)\b/i, "a leaf refusing to sit still"],
  ["bird", /\b(feathers?|wings?|breath)\b/i, "a bird auditioning for lead vocals"],
  ["road", /\b(road|lanes?|town|turn|waypoint|wrong side|home)\b/i, "a road taking the scenic route"],
  ["flag", /\b(flag|charge|fight|holding|hung)\b/i, "a flag waving a little too enthusiastically"],
  ["phone", /\b(telephone|wire|call)\b/i, "a telephone calling for an encore"],
  ["key", /\b(key|door)\b/i, "a key that forgot what it unlocks"],
  ["robot", /\b(agi|ai|robot|glosky)\b/i, "a robot learning to do the wiggle"],
  ["bee", /\b(swarm|bees?|buzz)\b/i, "a bee with a very busy dance schedule"],
  ["sword", /\b(warrior|ith|bomb|geglash)\b/i, "a toy sword taking a dance break"],
  ["pocket", /\b(pocket|trouble|little bit)\b/i, "a pocket full of tiny surprises"],
  ["mountain", /\b(stone|arreat|mountain|weight)\b/i, "a mountain trying to keep a low profile"],
  ["chain", /\b(ball|chain|down)\b/i, "a ball and chain practicing its swing"],
  ["bandage", /\b(pain|scar|scars)\b/i, "a bandage that makes everything a little better"],
  ["planet", /\b(gravity|orbit|space)\b/i, "a planet that cannot stop spinning"],
  ["trophy", /\b(made|score|trial)\b/i, "a trophy celebrating absolutely everything"],
  ["donut", /\b(round|dropped)\b/i, "a doughnut going round and round"],
  ["well", /\b(wishing|well)\b/i, "a wishing well making its own wish"],
  ["receipt", /\b(receipt|sale|proof|alibi)\b/i, "a receipt with some explaining to do"],
  ["radio", /\b(dial|siren|sirens|news|says|maw)\b/i, "a radio turning its own volume up"],
  ["washer", /\b(spin|cycle|wash)\b/i, "a washing machine on the dance cycle"],
  ["bolt", /\b(lightning|electric|thunder)\b/i, "a lightning bolt with too much energy"],
  ["clock", /\b(hours?|years?|counts?|time|wait|again)\b/i, "an alarm clock running fashionably late"],
  ["microphone", /\b(tony|tonys|sing|song|anthem)\b/i, "a microphone singing into another microphone"],
  ["guitar", /\b(acoustic|bluegrass|barnstorm|rock|blues|country|folk|unplugged)\b/i, "a guitar strumming itself silly"],
  ["trumpet", /\b(brass|brassline|ska|swing|jazz|horns?|fanfare)\b/i, "a trumpet puffing out its cheeks"],
  ["cassette", /\b(remix|rework|mix|dub|extended|edit|tape)\b/i, "a cassette tape rewinding for another go"],
  ["discoball", /\b(disco|boogie|groove|dance|pulse|club|funk|floor)\b/i, "a disco ball that never misses a party"],
  ["drum", /\b(bpm|beat|drums?|march|stomp|circuit|industrial)\b/i, "a drum keeping slightly irregular time"],
  ["note", /\b(opera|soul|choir|hymn|ballad|lounge|velvet|barbershop|quartet)\b/i, "a music note humming its own tune"],
];
// Titles without a recognizable subject share the band instead of one record.
const houseBand = [
  ["record", null, "a record doing a delightfully awkward dance"],
  ["microphone", null, "a microphone clearing its throat"],
  ["radio", null, "a radio turning its own volume up"],
  ["cassette", null, "a cassette tape rewinding for another go"],
  ["guitar", null, "a guitar strumming itself silly"],
  ["trumpet", null, "a trumpet puffing out its cheeks"],
  ["discoball", null, "a disco ball that never misses a party"],
  ["drum", null, "a drum keeping slightly irregular time"],
  ["note", null, "a music note humming its own tune"],
];
// Highest tier first. Every tier has its own mascots, colors, and stage so loved
// songs read as special at thumbnail size, and higher tiers keep escalating.
const tiers = [
  { votes: 7, stage: "legend", palettes: [["#2f2a4a", gold, "#ef6f9c"], ["#1f3044", "#ffd166", "#7bdff2"]], cast: [
    ["superstar", null, "a crowned superstar soaking up the applause"],
    ["gem", null, "a dazzling gem that knows it is a legend"],
  ] },
  { votes: 5, stage: "gold", palettes: [["#f4c542", "#e89b16", "#fff1b8"], ["#efb83a", "#d98a0b", "#fde9a6"]], cast: [
    ["goldrecord", null, "a framed gold record beaming with pride"],
    ["rocket", null, "a rocket taking this song to the top"],
  ] },
  { votes: 3, stage: "spotlight", palettes: [["#7cc8bd", "#f4a259", "#5b5f97"], ["#a3b3ee", "#f28482", "#f6bd60"]], cast: [
    ["medal", null, "a medal for a certified crowd favorite"],
    ["megaphone", null, "a megaphone telling everyone about this song"],
  ] },
  { votes: 1, stage: "loved", palettes: [["#f8a9bf", rose, "#ffd98a"], ["#f7b3c8", "#d94f86", "#9ad9e8"], ["#fbb5b5", "#e4526d", "#fff0a8"]], cast: [
    ["rosette", null, "a prize rosette blushing over its first fans"],
    ["balloon", null, "a party balloon floating on a little love"],
    ["foamfinger", null, "a foam finger cheering for its favorite song"],
  ] },
];
export function voteTier(votes) {
  const count = Number(votes);
  return tiers.find(tier => count >= tier.votes) || null;
}

// [arms and legs, left hand] so a held prop follows the pose.
const poses = [
  ["M62 117Q29 130 29 107M140 116Q165 142 176 119M81 145L75 170 57 170M121 146L132 165 146 161", [29, 107]],
  ["M62 112Q32 104 27 74M140 110Q170 102 176 72M81 145L72 171 56 169M121 146L127 171 143 170", [27, 74]],
  ["M62 117Q29 130 29 107M140 110Q172 100 172 68M84 145L84 171 68 171M119 146L134 166 148 160", [29, 107]],
  ["M62 114Q40 114 22 98M140 114Q164 122 181 102M81 145L66 166 52 160M121 146L121 171 137 171", [22, 98]],
];
// Drawn from the hand at 0,0. Empty hands stay the most common.
const props = [
  null, null, null,
  b => path("M0 0Q-7 -17 -3 -33") + ellipse(-3, -49, 13, 16, b),
  b => path("M0 0V-29") + [[0, -46], [9, -40], [6, -29], [-6, -29], [-9, -40]].map(([x, y]) => circle(x, y, 6, b)).join("") + circle(0, -37, 5, paper),
  b => path("M-2 -7V-41L15 -45V-15") + ellipse(-8, -7, 7, 5, b) + ellipse(9, -14, 7, 5, b),
  b => path("M0 0V-49") + path("M0 -49L27 -41 0 -31Z", b),
  b => path("M0 0V-27") + circle(0, -39, 13, b) + path("M0 -39Q6 -45 0 -47Q-8 -45 -6 -37Q-2 -29 6 -35"),
];
const openEye = (x, y, r, dx, dy, pupil) => circle(x, y, r, paper) + circle(x + dx, y + dy, pupil, ink);
const leftArc = path("M78 106Q85 96 92 105"), rightArc = path("M108 104Q116 94 123 103");
const eyes = [
  () => openEye(85, 102, 8, 1, 2, 3) + openEye(116, 99, 9, -1, 3, 3),
  () => openEye(85, 102, 8, 1, 2, 3) + rightArc,
  () => leftArc + openEye(116, 99, 9, -1, 3, 3),
  () => leftArc + rightArc,
  () => openEye(85, 102, 8, 0, 0, 2) + openEye(116, 99, 9, 0, 0, 2),
  () => openEye(85, 102, 8, 3, 0, 3) + openEye(116, 99, 9, 4, 0, 3),
  () => openEye(85, 102, 8, 0, 3, 3) + openEye(116, 99, 9, 0, 3, 3) + path("M77 102A8 8 0 0 1 93 102Z", ink) + path("M107 99A9 9 0 0 1 125 99Z", ink),
];
const heartEyes = '<path transform="translate(74 92)" d="' + miniHeart + '" fill="' + rose + '"/><path transform="translate(105 89) scale(1.1)" d="' + miniHeart + '" fill="' + rose + '"/>';
const starEyes = () => burst(85, 102, 11, 5, 5, gold) + burst(116, 99, 12, 5, 5, gold);
const mouths = [
  path("M92 119Q103 131 115 117", paper),
  path("M91 117Q103 140 116 115Z", "#b5473c"),
  ellipse(104, 124, 6, 7, "#b5473c"),
  path("M95 122Q107 128 116 116"),
  path("M92 119Q103 131 115 117", paper) + path("M99 125Q103 138 110 123Z", "#e8788a"),
];
// Faces sit in the same place on every drawing, so these fit the whole cast.
const extras = [
  null, null, null,
  { shades: true, draw: () => rect(73, 93, 24, 17, 6, ink) + rect(104, 90, 26, 18, 6, ink) + path("M97 100L104 98") },
  { draw: (a, b) => path("M103 140L87 131V149ZM103 140L119 131V149Z", b) + circle(103, 140, 4, a) },
  { draw: () => '<g stroke="none" fill="#e8788a" opacity=".6">' + circle(73, 117, 6, "#e8788a") + circle(130, 114, 6, "#e8788a") + '</g>' },
  { draw: () => path("M76 89L93 85M107 83L126 88") },
  { draw: () => circle(116, 99, 14, "none") + path("M128 107Q136 130 129 150") },
];
const backdrops = [
  () => '<circle cx="120" cy="95" r="78" fill="' + paper + '" opacity=".55"/>',
  () => '<path d="M52 60Q90 8 160 30Q222 52 204 120Q190 182 118 176Q40 172 38 110Q36 80 52 60Z" fill="' + paper + '" opacity=".55"/>',
  () => '<path d="M-10 150L110 -10H165L-10 222ZM70 210L222 5H250V40L122 210Z" fill="' + paper + '" opacity=".42"/>',
  () => '<g fill="' + paper + '" opacity=".5">' + Array.from({ length: 30 }, (_, i) => circle(20 + (i % 6) * 40 + (Math.floor(i / 6) % 2) * 20, 18 + Math.floor(i / 6) * 41, 8, paper)).join("") + '</g>',
  () => rays(120, 190, 14, paper, ".42"),
  () => '<path d="M46 200V96Q46 20 120 20Q194 20 194 96V200Z" fill="' + paper + '" opacity=".55"/>',
];
function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0), 16777619);
  // Avalanche the bits so every trait rolled below varies independently.
  result = Math.imul(result ^ (result >>> 16), 2246822507);
  result = Math.imul(result ^ (result >>> 13), 3266489909);
  return (result ^ (result >>> 16)) >>> 0;
}
function confetti(identity, style, a, b) {
  return Array.from({ length: 9 }, (_, index) => {
    const n = hash(identity + ":" + index), x = 13 + n % 213, y = 12 + (n >>> 8) % 174, color = index % 2 ? b : a;
    if (style === "hearts") return '<path transform="translate(' + x + " " + y + ') scale(' + (index % 3 ? ".55" : ".8") + ')" d="' + miniHeart + '" fill="' + (index % 2 ? paper : rose) + '" stroke="none"/>';
    if (style === "sparkles") return '<g stroke="none">' + burst(x, y, index % 3 ? 5 : 8, 2, 4, index % 2 ? paper : gold) + '</g>';
    if (style === 1) return index % 2 ? path("M" + x + " " + y + "h8m-4 -4v8", b) : circle(x, y, 2.5, a);
    if (style === 2) return '<path d="M' + x + " " + y + 'l7 2 -5 5Z" fill="' + color + '" stroke="none"/>';
    if (style === 3) return index % 2 ? '<circle cx="' + x + '" cy="' + y + '" r="4" fill="none" stroke="' + a + '"/>' : circle(x, y, 2, b);
    return index % 2 ? path("M" + x + " " + y + "l4 -5", b) : circle(x, y, 2, a);
  }).join("");
}
function stageMarkup(stage) {
  if (stage === "loved") return backdrops[0]();
  if (stage === "spotlight") return '<path d="M18 -5H86L176 200H66ZM222 -5H154L64 200H174Z" fill="' + paper + '" opacity=".36"/>';
  if (stage === "gold") return rays(120, 100, 12, paper, ".4") + '<circle cx="120" cy="98" r="70" fill="' + paper + '" opacity=".5"/>';
  // The night stage keeps a bright spotlight so the pen outlines stay readable.
  return rays(120, 100, 12, paper, ".1") + '<circle cx="120" cy="98" r="80" fill="' + paper + '" opacity=".93"/>';
}
const cache = new Map();
export function songArtwork(song) {
  const title = String(song.title || "Untitled song");
  const tier = voteTier(song.votes);
  const identity = String(song.id || "") + "\n" + title;
  const key = identity + "\n" + (tier?.votes || 0);
  if (cache.has(key)) return cache.get(key);
  const roll = (trait, size) => hash(identity + "\n" + trait) % size;
  // Titles are present in both lightweight API responses and full offline records.
  // Artwork never requires downloading lyrics or calling an image service.
  const matches = themes.filter(([, pattern]) => pattern.test(title));
  const subjects = matches.length ? matches : houseBand;
  const subject = subjects[roll("subject", subjects.length)];
  const [theme, , description] = tier ? tier.cast[roll("mascot", tier.cast.length)] : subject;
  // Award art keeps a small nod to the title; regular art shows a second subject.
  const others = matches.filter(([other]) => other !== subject[0]);
  const accentTheme = tier ? subject[0] : others.length ? others[roll("accent", others.length)][0] : null;
  const [background, a, b] = (tier?.palettes || palettes)[roll("palette", (tier?.palettes || palettes).length)];
  const tilt = roll("tilt", 17) - 8, flipped = roll("flip", 2) === 1;
  const [limbs, hand] = poses[tier?.votes >= 5 ? 1 : roll("pose", poses.length)];
  const prop = tier ? null : props[roll("prop", props.length)];
  const extra = extras[roll("extra", extras.length)];
  const special = tier && roll("eyes", 2) ? (tier.votes >= 5 ? starEyes() : tier.votes === 1 ? heartEyes : null) : null;
  const face = (extra?.shades && !special ? "" : special || eyes[roll("eyes", eyes.length)]()) + mouths[roll("mouth", mouths.length)] + (extra && !(extra.shades && special) ? extra.draw(a, b) : "");
  const dark = tier?.stage === "legend";
  const specks = confetti(identity, tier?.stage === "loved" ? "hearts" : tier?.votes >= 5 ? "sparkles" : roll("confetti", 4), a, b);
  const badgeX = flipped ? 19 : 202;
  // Tier hearts stay top right: the grid's track number covers the top-left corner.
  const badge = tier
    ? Array.from({ length: tiers.length - tiers.indexOf(tier) }, (_, i) => '<path transform="translate(' + (212 - i * 18) + ' 11) scale(.85)" d="' + miniHeart + '"/>').join("")
    : '<g transform="translate(' + badgeX + ' 19)"><path d="M0 8L7 7 9 0 12 7 19 9 12 12 10 19 7 12 0 10Z"/></g>';
  const accentX = roll("accent-side", 2) ? 176 : 8;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200" viewBox="0 0 240 200">'
    + '<rect width="240" height="200" fill="' + background + '"/>' + (tier ? stageMarkup(tier.stage) :backdrops[roll("backdrop", backdrops.length)]())
    + '<g stroke="' + b + '" stroke-width="2" stroke-linecap="round">' + specks + '</g><ellipse cx="122" cy="176" rx="62" ry="8" fill="' + ink + '" opacity=".10"/>'
    + '<g transform="translate(20 -2) rotate(' + tilt + ' 100 100)' + (flipped ? " translate(200 0) scale(-1 1)" : "") + '" stroke="' + ink + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">'
    + path(limbs) + (prop ? '<g transform="translate(' + hand[0] + " " + hand[1] + ')">' + prop(b) + '</g>' : "")
    + drawings[theme](a, b) + face + '</g>'
    + (accentTheme ? '<g transform="translate(' + accentX + ' 130) scale(.28) rotate(12 100 100)" stroke="' + ink + '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">' + drawings[accentTheme](dark ? a : b, dark ? b : a) + '</g>' : "")
    + '<g fill="' + (tier ? rose : paper) + '" stroke="' + (dark ? paper : ink) + '" stroke-width="2" stroke-linejoin="round">' + badge + '</g>'
    + (tier?.votes >= 5 ? '<rect x="5" y="5" width="230" height="190" rx="7" fill="none" stroke="' + (dark ? gold : "#a86a08") + '" stroke-width="4"/>' + (dark ? '<rect x="12" y="12" width="216" height="176" rx="4" fill="none" stroke="' + gold + '" stroke-width="1.5"/>' : "") : "")
    + '</svg>';
  const art = { src: "data:image/svg+xml," + encodeURIComponent(svg), alt: "Silly clip art: " + description + ".", theme, tier: tier?.votes || 0 };
  // Bound memory use on pages left open as the catalog changes.
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key, art);
  return art;
}
export function songArtworkMarkup(song, escape) {
  const art = songArtwork(song);
  return '<img class="track-art" src="' + escape(art.src) + '" alt="' + escape(art.alt) + '"' + (art.tier ? ' data-art-tier="' + art.tier + '"' : "") + ' width="240" height="200" loading="lazy" decoding="async">';
}
