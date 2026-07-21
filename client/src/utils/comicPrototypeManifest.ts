export interface ComicTextWord {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
}

export interface ComicTextLine {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  context: string;
  words?: ComicTextWord[];
}

export interface ComicPrototypePageDefinition {
  entrySuffix: string;
  width: number;
  height: number;
  lines: ComicTextLine[];
}

const line = (
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  context: string,
): ComicTextLine => ({ x, y, width, height, text, context });

const p9MotherQuestion = 'And may I ask where you are going in the midst of the fine moonlight, Ruthye, my darling one?';
const p9Unexpected = 'I did not expect to see you, Mother.';
const p9Dreams = 'I hope that the death of my father has not caused you poor dreams.';
const p9Advice = 'You are a mite young to be seeking through the world hoping for blood. Maybe you should listen to your brothers and sit and wait for amends to come.';
const p9Wait = "Hm. If I was going to sit and wait for the impossible, I'd sit and wait for Daddy to rise up from our good sod and hold me once again.";
const p9Direction = 'But I am not inclined in that direction.';
const p9Mount = "Well. Take your late father's mount.";
const p9Troubles = "He's an ornery one and I don't feel like caring for him. I got enough troubles.";

const page9Lines: ComicTextLine[] = [
  line(1474, 160, 118, 21, 'AND MAY', p9MotherQuestion),
  line(1449, 188, 168, 22, 'I ASK WHERE', p9MotherQuestion),
  line(1426, 218, 214, 21, 'YOU ARE GOING', p9MotherQuestion),
  line(1399, 246, 269, 22, 'IN THE MIDST OF THE', p9MotherQuestion),
  line(1423, 276, 221, 23, 'FINE MOONLIGHT,', p9MotherQuestion),
  line(1459, 305, 148, 23, 'RUTHYE, MY', p9MotherQuestion),
  line(1479, 335, 108, 21, 'DARLING', p9MotherQuestion),
  line(1497, 363, 71, 22, 'ONE?', p9MotherQuestion),

  line(132, 749, 238, 21, 'I DID NOT EXPECT', p9Unexpected),
  line(172, 777, 157, 24, 'TO SEE YOU,', p9Unexpected),
  line(195, 807, 111, 21, 'MOTHER.', p9Unexpected),

  line(312, 852, 93, 20, 'I HOPE', p9Dreams),
  line(256, 881, 205, 20, 'THAT THE DEATH', p9Dreams),
  line(235, 909, 248, 22, 'OF MY FATHER HAS', p9Dreams),
  line(278, 938, 163, 22, 'NOT CAUSED', p9Dreams),
  line(289, 968, 140, 21, 'YOU POOR', p9Dreams),
  line(306, 996, 105, 22, 'DREAMS.', p9Dreams),

  line(970, 1257, 345, 22, 'YOU ARE A MITE YOUNG TO', p9Advice),
  line(1000, 1286, 285, 22, 'BE SEEKING THROUGH', p9Advice),
  line(1011, 1316, 262, 21, 'THE WORLD HOPING', p9Advice),
  line(1064, 1345, 158, 21, 'FOR BLOOD.', p9Advice),
  line(991, 1398, 148, 21, 'MAYBE YOU', p9Advice),
  line(970, 1426, 190, 23, 'SHOULD LISTEN', p9Advice),
  line(937, 1456, 256, 21, 'TO YOUR BROTHERS', p9Advice),
  line(946, 1485, 238, 22, 'AND SIT AND WAIT', p9Advice),
  line(981, 1514, 169, 22, 'FOR AMENDS', p9Advice),
  line(1001, 1544, 128, 21, 'TO COME.', p9Advice),

  line(314, 1747, 40, 21, 'HM.', p9Wait),
  line(515, 1733, 108, 22, 'IF I WAS', p9Wait),
  line(445, 1762, 248, 22, 'GOING TO SIT AND', p9Wait),
  line(398, 1791, 342, 24, 'WAIT FOR THE IMPOSSIBLE,', p9Wait),
  line(378, 1820, 382, 22, "I'D SIT AND WAIT FOR DADDY", p9Wait),
  line(369, 1850, 399, 22, 'TO RISE UP FROM OUR GOOD', p9Wait),
  line(441, 1879, 255, 22, 'SOD AND HOLD ME', p9Wait),
  line(482, 1909, 173, 22, 'ONCE AGAIN.', p9Wait),

  line(1327, 1939, 128, 21, 'BUT I AM', p9Direction),
  line(1283, 1968, 216, 21, 'NOT INCLINED IN', p9Direction),
  line(1291, 1998, 198, 22, 'THAT DIRECTION.', p9Direction),

  line(194, 2600, 64, 20, 'WELL.', p9Mount),
  line(279, 2645, 140, 21, 'TAKE YOUR', p9Mount),
  line(262, 2674, 174, 21, "LATE FATHER'S", p9Mount),
  line(301, 2703, 96, 22, 'MOUNT.', p9Mount),

  line(1623, 2708, 96, 22, "HE'S AN", p9Troubles),
  line(1587, 2738, 168, 21, 'ORNERY ONE', p9Troubles),
  line(1552, 2767, 239, 22, "AND I DON'T FEEL", p9Troubles),
  line(1528, 2796, 287, 22, 'LIKE CARING FOR HIM.', p9Troubles),
  line(1569, 2825, 205, 22, 'I GOT ENOUGH', p9Troubles),
  line(1605, 2854, 132, 22, 'TROUBLES.', p9Troubles),
];

const p11Tracked = "So, you've tracked a kingsagent across the plains to here--to the Whaletower. And you need someone to tote you over those mighty baracades and help you kill the poor ox.";
const p11Cheap = "Even if it was feasible, wouldn't be cheap.";
const p11Request = 'I did not come to you because I thought you would be cheap. I came to you, sir, because good folks tell me you are the most ruthless bounty inside the city walls. And I have need of a ruthless man.';
const p11Sword = 'See here. If you examine this sword you will find it of high quality and worth.';
const p11Sky = 'As I have traveled, many well-practiced smiths have offered me the sky for it, but I have no need for the sky.';
const p11No = 'No. You have need for a ruthless man.';
const p11Payment = 'The blade will be provided to you when I witness the death of Krem of the Yellow Hills.';
const p11Reply = 'Whether that is to your satisfaction or not, I would appreciate a reply as rapidly as you are able.';
const p11Wound = 'For every moment that passes that Krem breathes the air above pains me, like a wound that will not heal.';

const page11Lines: ComicTextLine[] = [
  line(125, 126, 300, 22, "SO, YOU'VE TRACKED A", p11Tracked),
  line(111, 155, 328, 23, 'KINGSAGENT ACROSS THE', p11Tracked),
  line(122, 185, 306, 22, 'PLAINS TO HERE--TO THE', p11Tracked),
  line(187, 215, 176, 21, 'WHALETOWER.', p11Tracked),
  line(233, 279, 119, 22, 'AND YOU', p11Tracked),
  line(191, 308, 205, 22, 'NEED SOMEONE', p11Tracked),
  line(167, 338, 253, 21, 'TO TOTE YOU OVER', p11Tracked),
  line(200, 366, 187, 22, 'THOSE MIGHTY', p11Tracked),
  line(151, 395, 286, 23, 'BARACADES AND HELP', p11Tracked),
  line(208, 426, 170, 20, 'YOU KILL THE', p11Tracked),
  line(229, 455, 129, 20, 'POOR OX.', p11Tracked),

  line(952, 213, 127, 22, 'EVEN IF IT', p11Cheap),
  line(925, 241, 180, 24, 'WAS FEASIBLE,', p11Cheap),
  line(927, 271, 175, 22, "WOULDN'T BE", p11Cheap),
  line(974, 301, 83, 21, 'CHEAP.', p11Cheap),

  line(1218, 112, 462, 22, 'I DID NOT COME TO YOU BECAUSE', p11Request),
  line(1290, 142, 319, 21, 'I THOUGHT YOU WOULD', p11Request),
  line(1386, 171, 128, 21, 'BE CHEAP.', p11Request),
  line(1410, 229, 96, 22, 'I CAME', p11Request),
  line(1315, 257, 285, 24, 'TO YOU, SIR, BECAUSE', p11Request),
  line(1314, 287, 289, 22, 'GOOD FOLKS TELL ME', p11Request),
  line(1277, 316, 363, 22, 'YOU ARE THE MOST RUTHLESS', p11Request),
  line(1334, 345, 249, 22, 'BOUNTY INSIDE THE', p11Request),
  line(1385, 374, 147, 22, 'CITY WALLS.', p11Request),
  line(1418, 438, 78, 21, 'AND I', p11Request),
  line(1364, 467, 187, 22, 'HAVE NEED OF', p11Request),
  line(1383, 495, 148, 22, 'A RUTHLESS', p11Request),
  line(1426, 525, 63, 22, 'MAN.', p11Request),

  line(939, 1282, 120, 21, 'SEE HERE.', p11Sword),
  line(1109, 1279, 439, 23, 'IF YOU EXAMINE THIS SWORD YOU', p11Sword),
  line(1131, 1309, 396, 22, 'WILL FIND IT OF HIGH QUALITY', p11Sword),
  line(1247, 1339, 162, 21, 'AND WORTH.', p11Sword),

  line(1368, 1395, 130, 22, 'AS I HAVE', p11Sky),
  line(1330, 1425, 206, 23, 'TRAVELED, MANY', p11Sky),
  line(1278, 1453, 310, 22, 'WELL-PRACTICED SMITHS', p11Sky),
  line(1286, 1483, 294, 22, 'HAVE OFFERED ME THE', p11Sky),
  line(1279, 1511, 307, 24, 'SKY FOR IT, BUT I HAVE', p11Sky),
  line(1342, 1541, 184, 22, 'NO NEED FOR', p11Sky),
  line(1382, 1570, 101, 22, 'THE SKY.', p11Sky),

  line(703, 2317, 36, 21, 'NO.', p11No),
  line(752, 2367, 126, 21, 'YOU HAVE', p11No),
  line(735, 2396, 162, 22, 'NEED FOR A', p11No),
  line(757, 2424, 116, 22, 'RUTHLESS', p11No),
  line(784, 2454, 63, 22, 'MAN.', p11No),

  line(986, 2248, 496, 21, 'THE BLADE WILL BE PROVIDED TO YOU', p11Payment),
  line(997, 2277, 488, 22, 'WHEN I WITNESS THE DEATH OF KREM', p11Payment),
  line(1103, 2306, 276, 22, 'OF THE YELLOW HILLS.', p11Payment),

  line(1094, 2353, 216, 22, 'WHETHER THAT IS', p11Reply),
  line(1037, 2382, 331, 22, 'TO YOUR SATISFACTION OR', p11Reply),
  line(1030, 2412, 345, 23, 'NOT, I WOULD APPRECIATE', p11Reply),
  line(1055, 2440, 294, 22, 'A REPLY AS RAPIDLY AS', p11Reply),
  line(1105, 2470, 194, 21, 'YOU ARE ABLE.', p11Reply),

  line(1075, 2530, 138, 21, 'FOR EVERY', p11Wound),
  line(1052, 2559, 184, 21, 'MOMENT THAT', p11Wound),
  line(1027, 2587, 233, 22, 'PASSES THAT KREM', p11Wound),
  line(1028, 2616, 232, 22, 'BREATHES THE AIR', p11Wound),
  line(1031, 2645, 224, 24, 'ABOVE PAINS ME,', p11Wound),
  line(1049, 2675, 190, 22, 'LIKE A WOUND', p11Wound),
  line(1048, 2705, 191, 21, 'THAT WILL NOT', p11Wound),
  line(1111, 2734, 65, 21, 'HEAL.', p11Wound),
];

export const SUPERGIRL_CBZ_PROTOTYPE = {
  title: 'Supergirl: Woman of Tomorrow',
  author: 'Tom King · Bilquis Evely',
  language: 'en',
  pages: [
    {
      entrySuffix: '-009.jpg',
      width: 1988,
      height: 3057,
      lines: page9Lines,
    },
    {
      entrySuffix: '-011.jpg',
      width: 1988,
      height: 3057,
      lines: page11Lines,
    },
  ] satisfies ComicPrototypePageDefinition[],
};
