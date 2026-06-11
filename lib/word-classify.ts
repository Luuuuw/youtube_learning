import { getLocalDictEntry } from './local-dict';

// ── Legacy types (kept for backward compat with subtitle highlighting) ──

export type WordCategory = 'verb' | 'noun' | 'adj' | 'adv' | 'prep' | 'pron' | 'conj' | 'det' | 'num' | 'int' | 'art' | 'other';

export interface WordClassResult {
  category: WordCategory;
  label: string;
  color: string;
  bgColor: string;
  isKeyVocab: boolean;
}

// ── New: Learning priority ──

export type LearningPriority = 'core' | 'advanced' | 'basic';

export type ExamLevel = '四级' | '六级' | '考研' | '雅思' | '托福' | '专八';

export interface VideoVocabEntry {
  word: string;
  count: number;
  priority: LearningPriority;
  /** First subtitle index where this word appears */
  firstIndex: number;
  /** Local dict definition (if available) */
  definition: string | null;
  /** Part-of-speech label from local dict */
  pos: string | null;
  /** Exam level tag */
  examLevel: ExamLevel | null;
}

const CATEGORY_CONFIG: Record<WordCategory, { label: string; color: string; bgColor: string }> = {
  verb: { label: '动词', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-100 dark:bg-green-900/40' },
  noun: { label: '名词', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-900/40' },
  adj: { label: '形容词', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/40' },
  adv: { label: '副词', color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-100 dark:bg-purple-900/40' },
  prep: { label: '介词', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-100 dark:bg-slate-800/30' },
  pron: { label: '代词', color: 'text-pink-700 dark:text-pink-300', bgColor: 'bg-pink-100 dark:bg-pink-900/30' },
  conj: { label: '连词', color: 'text-teal-700 dark:text-teal-300', bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  det: { label: '限定词', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
  num: { label: '数字', color: 'text-indigo-700 dark:text-indigo-300', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  int: { label: '感叹词', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  art: { label: '冠词', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
  other: { label: '其他', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
};

const KEY_VOCAB_CATEGORIES = new Set<WordCategory>(['verb', 'noun', 'adj', 'adv']);

// ── Stop words: function words that don't need learning ──
const STOP_WORDS = new Set([
  // Articles
  'the', 'a', 'an',
  // Be verbs
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  // Aux verbs
  'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself',
  'ourselves', 'themselves',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'than',
  // Prepositions
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from', 'up', 'down',
  'out', 'off', 'over', 'under', 'into', 'about', 'after', 'before', 'through',
  // Adverbs/particles
  'not', 'no', 'yes', 'ok', 'okay', 'oh', 'well', 'too', 'very', 'just', 'also',
  'here', 'there', 'when', 'where', 'how', 'now', 'then', 'again', 'once', 'back',
  // Determiners
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any',
  'other', 'another', 'such', 'same', 'own', 'only', 'even', 'still',
  // Question words
  'what', 'which', 'who', 'whom', 'whose',
  // Common filler
  'like', 'got', 'get', 'gets', 'really', 'much', 'many', 'lot',
  // Contractions / fragments
  'im', 'ive', 'id', 'youre', 'youve', 'youll', 'youd',
  'hes', 'shes', 'its', 'were', 'theyre', 'theyve', 'theyll',
  'dont', 'doesnt', 'didnt', 'wont', 'wouldnt', 'couldnt', 'shouldnt',
  'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent', 'hadnt',
  'lets', 'thats', 'theres', 'heres', 'whats', 'wheres', 'hows',
  'gonna', 'gotta', 'wanna', 'kinda', 'sorta', 'cause', 'til',
]);

// ── Basic words: common words that most learners already know ──
// These are in local-dict but are too simple to be "advanced"
const BASIC_WORDS = new Set([
  // Body parts
  'eye', 'eyes', 'ear', 'ears', 'nose', 'mouth', 'hand', 'hands', 'head', 'face',
  'foot', 'feet', 'leg', 'legs', 'arm', 'arms', 'hair', 'skin', 'heart', 'blood',
  'bone', 'teeth', 'tooth', 'back', 'neck', 'finger', 'body',
  // Family
  'mother', 'father', 'parent', 'parents', 'brother', 'sister', 'son', 'daughter',
  'child', 'children', 'baby', 'family', 'wife', 'husband', 'man', 'woman',
  'men', 'women', 'boy', 'girl', 'friend',
  // Colors
  'red', 'blue', 'green', 'yellow', 'white', 'black', 'brown', 'pink', 'orange', 'gray',
  // Numbers (spelled out)
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'hundred', 'thousand', 'million', 'first', 'second', 'third',
  // Time
  'day', 'days', 'week', 'month', 'year', 'years', 'time', 'hour', 'hours',
  'minute', 'minutes', 'morning', 'afternoon', 'evening', 'night', 'today',
  'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday',
  // Common nouns
  'water', 'food', 'house', 'home', 'room', 'door', 'window', 'table', 'chair',
  'bed', 'car', 'book', 'books', 'school', 'work', 'money', 'name', 'life',
  'world', 'country', 'city', 'street', 'road', 'place', 'thing', 'things',
  'way', 'people', 'person', 'part', 'side', 'end', 'point', 'fact',
  // Common verbs (very basic)
  'go', 'goes', 'went', 'gone', 'come', 'came', 'make', 'made', 'take', 'took',
  'give', 'gave', 'say', 'said', 'tell', 'told', 'know', 'knew', 'think', 'thought',
  'see', 'saw', 'look', 'want', 'need', 'try', 'feel', 'felt', 'leave', 'left',
  'call', 'keep', 'let', 'begin', 'show', 'hear', 'heard', 'play', 'run', 'move',
  'live', 'believe', 'bring', 'brought', 'happen', 'write', 'written', 'read',
  'turn', 'start', 'stop', 'open', 'close', 'walk', 'eat', 'ate', 'drink', 'sleep',
  'sit', 'stand', 'fall', 'fell', 'grow', 'send', 'sent',
  // Common adjectives (very basic)
  'good', 'bad', 'big', 'small', 'long', 'short', 'old', 'new', 'young',
  'high', 'low', 'hot', 'cold', 'right', 'left', 'happy', 'sad', 'hard',
  'easy', 'fast', 'slow', 'full', 'empty', 'clean', 'dark', 'light',
  'different', 'same', 'important', 'possible', 'true', 'real', 'sure',
  'free', 'ready', 'nice', 'great', 'little', 'last', 'next', 'best',
  'better', 'worse', 'able',
  // Common adverbs
  'always', 'never', 'often', 'sometimes', 'usually', 'already', 'still',
  'ever', 'never', 'quite', 'rather',
  // Food/drink
  'tea', 'coffee', 'milk', 'bread', 'meat', 'rice', 'cake', 'fruit',
  // Nature
  'sun', 'moon', 'star', 'rain', 'snow', 'wind', 'tree', 'trees', 'grass',
  'river', 'sea', 'mountain', 'sky', 'fire', 'air', 'earth', 'ground',
  // Animals
  'dog', 'cat', 'bird', 'fish', 'horse', 'cow',
]);

// ── Exam level word lists ──
// CET-4 core words (subset - most common CET-4 words that aren't in BASIC_WORDS)
const CET4_WORDS = new Set([
  'ability', 'absent', 'absorb', 'abstract', 'academic', 'accept', 'access', 'accident',
  'accomplish', 'account', 'accurate', 'accuse', 'achieve', 'acknowledge', 'acquire',
  'adapt', 'addition', 'adequate', 'adjust', 'administration', 'admire', 'admit',
  'adopt', 'adult', 'advance', 'advantage', 'adventure', 'advertise', 'advice',
  'affair', 'affect', 'afford', 'aggressive', 'agriculture', 'alarm', 'allocate',
  'allow', 'alternative', 'ambition', 'amount', 'amuse', 'analyze', 'ancestor',
  'announce', 'annual', 'anxiety', 'anxious', 'apologize', 'appeal', 'appear',
  'appetite', 'appliance', 'application', 'apply', 'appoint', 'appreciate',
  'approach', 'appropriate', 'approve', 'argue', 'arrange', 'arrest', 'arrival',
  'artificial', 'assess', 'assign', 'assist', 'associate', 'assume', 'assure',
  'atmosphere', 'attach', 'attempt', 'attend', 'attitude', 'attract', 'audience',
  'authority', 'automatic', 'available', 'average', 'avoid', 'awake', 'award',
  'aware', 'awful', 'balance', 'ban', 'bargain', 'barrier', 'basis', 'battle',
  'bear', 'behave', 'belief', 'belong', 'beneath', 'benefit', 'betray', 'birth',
  'blame', 'blank', 'bleed', 'blend', 'blind', 'block', 'bloom', 'blow',
  'board', 'boil', 'bond', 'border', 'bore', 'bother', 'boundary', 'bow',
  'brain', 'brand', 'brave', 'breadth', 'break', 'breath', 'breathe', 'breed',
  'brief', 'brilliant', 'broadcast', 'budget', 'burden', 'bureaucracy', 'burst',
  'bury', 'cabin', 'calculate', 'campaign', 'cancel', 'candidate', 'capable',
  'capacity', 'capture', 'career', 'casual', 'category', 'cause', 'caution',
  'celebrate', 'challenge', 'champion', 'channel', 'chapter', 'characteristic',
  'charge', 'charity', 'chart', 'chase', 'cheap', 'cheat', 'check', 'cheer',
  'chief', 'choice', 'circumstance', 'citizen', 'civil', 'claim', 'classify',
  'climate', 'clue', 'coach', 'coincidence', 'collapse', 'colleague', 'collect',
  'combination', 'combine', 'comfort', 'command', 'comment', 'commerce',
  'commit', 'committee', 'communicate', 'community', 'companion', 'compare',
  'compel', 'compensate', 'compete', 'complaint', 'complex', 'complicate',
  'component', 'compose', 'comprehensive', 'compromise', 'concentrate',
  'concept', 'concern', 'conclude', 'concrete', 'condition', 'conduct',
  'conference', 'confidence', 'confirm', 'conflict', 'confuse', 'connect',
  'conscience', 'conscious', 'consequence', 'conservative', 'consider',
  'consist', 'constant', 'constitute', 'construct', 'consult', 'consume',
  'contact', 'contain', 'contemporary', 'content', 'contest', 'context',
  'continue', 'contract', 'contradict', 'contribute', 'control', 'convenient',
  'convention', 'convince', 'cooperate', 'cope', 'core', 'corporation',
  'correct', 'correspond', 'corrupt', 'cottage', 'council', 'courage',
  'crash', 'creative', 'creature', 'crisis', 'criterion', 'critical',
  'cultivate', 'culture', 'curiosity', 'current', 'curse', 'custom',
  'cycle', 'deadline', 'debate', 'debt', 'decade', 'decay', 'deceive',
  'declare', 'decline', 'decorate', 'decrease', 'dedicate', 'defeat',
  'defend', 'define', 'definite', 'delay', 'delegate', 'deliberate',
  'delicate', 'deliver', 'demand', 'demonstrate', 'deny', 'depart',
  'depend', 'deposit', 'depress', 'derive', 'describe', 'desert',
  'deserve', 'design', 'desire', 'despair', 'desperate', 'despite',
  'destroy', 'destruction', 'detail', 'detect', 'determine', 'develop',
  'device', 'devote', 'dialogue', 'differ', 'digest', 'dilemma',
  'dimension', 'dinner', 'diploma', 'direct', 'disaster', 'discipline',
  'discount', 'discover', 'discrimination', 'discuss', 'disease',
  'disguise', 'dismiss', 'display', 'dispose', 'dispute', 'distant',
  'distinct', 'distinction', 'distinguish', 'distribute', 'disturb',
  'diverse', 'divide', 'domestic', 'dominate', 'donate', 'dormitory',
  'dose', 'doubt', 'draft', 'drama', 'drastic', 'drift', 'drought',
  'durable', 'duty', 'dynamic', 'eager', 'earn', 'economy', 'edition',
  'editor', 'educate', 'effect', 'efficient', 'effort', 'elaborate',
  'election', 'elegant', 'element', 'eliminate', 'embrace', 'emerge',
  'emergency', 'emotion', 'emphasize', 'employ', 'enable', 'encounter',
  'encourage', 'endure', 'enemy', 'enforce', 'engage', 'enhance',
  'enormous', 'ensure', 'enterprise', 'enthusiasm', 'entire', 'entry',
  'environment', 'episode', 'equal', 'equip', 'equivalent', 'escape',
  'essential', 'establish', 'estimate', 'evaluate', 'eventually',
  'evidence', 'evil', 'evolution', 'exaggerate', 'examine', 'exceed',
  'excellent', 'except', 'exchange', 'excite', 'exclude', 'execute',
  'executive', 'exercise', 'exert', 'exhibit', 'exist', 'expand',
  'expect', 'expense', 'experiment', 'expert', 'explain', 'explicit',
  'exploit', 'explore', 'export', 'expose', 'extend', 'extent',
  'external', 'extraordinary', 'extreme', 'facility', 'factor',
  'failure', 'faith', 'familiar', 'famine', 'fancy', 'fare',
  'fascinate', 'fashion', 'fatal', 'fate', 'fault', 'favor',
  'feature', 'federal', 'fierce', 'figure', 'finance', 'flexible',
  'flight', 'float', 'flood', 'flourish', 'fluent', 'focus',
  'forbid', 'forecast', 'foreign', 'forgive', 'formal', 'format',
  'former', 'formula', 'fortune', 'foundation', 'fraction', 'fragment',
  'frame', 'frequent', 'friction', 'frontier', 'frustrate', 'fulfill',
  'function', 'fund', 'fundamental', 'furnish', 'fuss', 'gallery',
  'gap', 'garlic', 'gather', 'gaze', 'gender', 'gene', 'generate',
  'generous', 'genius', 'gentle', 'genuine', 'gesture', 'glimpse',
  'global', 'gloomy', 'glory', 'govern', 'grace', 'gradual',
  'graduate', 'grand', 'grant', 'grasp', 'grateful', 'grave',
  'guarantee', 'guard', 'guidance', 'guilty', 'gym', 'harbor',
  'harmony', 'harvest', 'hate', 'headquarters', 'heal', 'heap',
  'heavily', 'hedge', 'hesitate', 'highlight', 'hint', 'hire',
  'hollow', 'honor', 'horizon', 'horror', 'hostile', 'humble',
  'humor', 'hunger', 'hurry', 'ideal', 'identify', 'ignorant',
  'ignore', 'illegal', 'illustrate', 'image', 'immediate', 'immense',
  'immigrant', 'impact', 'imply', 'import', 'impose', 'impress',
  'impulse', 'incident', 'include', 'income', 'increase', 'independent',
  'indicate', 'individual', 'industrial', 'inevitable', 'infect',
  'inferior', 'infinite', 'influence', 'inform', 'ingredient',
  'initial', 'initiative', 'innocent', 'innovation', 'inquire',
  'insert', 'insight', 'insist', 'inspect', 'inspire', 'install',
  'instance', 'instant', 'institute', 'instruct', 'instrument',
  'insurance', 'intellectual', 'intelligent', 'intend', 'intense',
  'interact', 'interior', 'interpret', 'interrupt', 'interval',
  'interview', 'intimate', 'introduce', 'invade', 'investigate',
  'investment', 'invisible', 'involve', 'isolate', 'issue', 'jail',
  'jealous', 'journal', 'journey', 'judge', 'junction', 'junior',
  'justice', 'justify', 'keen', 'labor', 'lack', 'landscape',
  'launch', 'layer', 'league', 'lean', 'lecture', 'legal', 'legend',
  'leisure', 'liberal', 'liberty', 'license', 'likewise', 'limit',
  'liquid', 'literary', 'literature', 'loan', 'locate', 'logical',
  'loyal', 'luxury', 'magnificent', 'maintain', 'major', 'manage',
  'manner', 'manual', 'manufacture', 'margin', 'master', 'material',
  'mature', 'maximum', 'meanwhile', 'measure', 'mechanism', 'media',
  'medium', 'mental', 'mention', 'merchant', 'mercy', 'mere',
  'merit', 'method', 'military', 'minimum', 'minister', 'minor',
  'miracle', 'mission', 'moderate', 'modify', 'monitor', 'moral',
  'motion', 'motivate', 'motive', 'multiply', 'mutual', 'mystery',
  'narrow', 'nation', 'native', 'negative', 'neglect', 'negotiate',
  'neutral', 'noble', 'norm', 'notion', 'nuclear', 'numerous',
  'objective', 'oblige', 'observe', 'obtain', 'obvious', 'occasion',
  'occupy', 'occur', 'offend', 'official', 'ongoing', 'operate',
  'opinion', 'opponent', 'opportunity', 'oppose', 'opposite',
  'option', 'orbit', 'ordinary', 'organ', 'organize', 'origin',
  'outcome', 'outline', 'output', 'overcome', 'overlook', 'owe',
  'oxygen', 'pace', 'panel', 'parallel', 'participate', 'particular',
  'partner', 'passage', 'passion', 'passive', 'patience', 'pattern',
  'pause', 'peculiar', 'penalty', 'perceive', 'percentage',
  'perform', 'permanent', 'permit', 'persist', 'personal',
  'perspective', 'persuade', 'phenomenon', 'philosophy', 'physical',
  'planet', 'platform', 'pleasant', 'pledge', 'plot', 'plug',
  'plunge', 'policy', 'polish', 'politics', 'pollution', 'popular',
  'population', 'portrait', 'possess', 'potential', 'poverty',
  'practical', 'praise', 'precious', 'precise', 'predict', 'prefer',
  'prejudice', 'premise', 'premium', 'prepare', 'prescribe',
  'presence', 'preserve', 'president', 'press', 'pressure',
  'pretend', 'previous', 'principle', 'prior', 'privilege',
  'proceed', 'process', 'profession', 'profile', 'profit',
  'program', 'progress', 'project', 'promote', 'prompt', 'proportion',
  'propose', 'prospect', 'protect', 'protest', 'prove', 'provide',
  'provision', 'psychology', 'publish', 'purchase', 'pursue',
  'qualify', 'quantity', 'queue', 'quit', 'quote', 'racial',
  'random', 'range', 'rank', 'rapid', 'rare', 'rate', 'ratio',
  'rational', 'react', 'reality', 'realm', 'rear', 'reasonable',
  'recall', 'receive', 'recession', 'recognize', 'recommend',
  'recover', 'recruit', 'reduce', 'refer', 'reflect', 'reform',
  'refresh', 'refuse', 'regard', 'region', 'register', 'regulate',
  'reject', 'relate', 'relative', 'release', 'relevant', 'relief',
  'religion', 'reluctant', 'rely', 'remain', 'remark', 'remedy',
  'remote', 'remove', 'render', 'renew', 'rent', 'repair',
  'repeat', 'replace', 'represent', 'reproduce', 'republic',
  'reputation', 'request', 'require', 'rescue', 'research',
  'reserve', 'resident', 'resign', 'resist', 'resolve', 'resort',
  'resource', 'respond', 'restore', 'restrict', 'result', 'retire',
  'retreat', 'reveal', 'revenue', 'reverse', 'revise', 'revolt',
  'reward', 'rhythm', 'ridiculous', 'rigid', 'risk', 'rival',
  'role', 'routine', 'ruin', 'rural', 'sacrifice', 'salary',
  'sample', 'satisfy', 'scale', 'scatter', 'scene', 'schedule',
  'scheme', 'scholar', 'scope', 'score', 'screen', 'secure',
  'select', 'senior', 'sense', 'sensitive', 'separate', 'sequence',
  'series', 'session', 'settle', 'severe', 'shadow', 'shallow',
  'shelter', 'shift', 'shortage', 'shrink', 'signal', 'significant',
  'similar', 'simplify', 'simulate', 'sincere', 'site', 'situation',
  'sketch', 'slight', 'slim', 'smooth', 'social', 'software',
  'solution', 'solve', 'sophisticated', 'source', 'specific',
  'speculate', 'sphere', 'spirit', 'sponsor', 'spot', 'stable',
  'standard', 'status', 'steady', 'steer', 'stem', 'stimulate',
  'strategy', 'strength', 'stress', 'stretch', 'strict', 'strike',
  'structure', 'struggle', 'stuff', 'submit', 'substance',
  'substitute', 'succeed', 'sufficient', 'suggest', 'suit',
  'summarize', 'superior', 'supplement', 'supply', 'support',
  'suppose', 'suppress', 'surface', 'surplus', 'surround',
  'survey', 'survive', 'suspect', 'suspend', 'sustain', 'swallow',
  'symbol', 'sympathy', 'symptom', 'system', 'talent', 'target',
  'tax', 'team', 'technical', 'technique', 'technology', 'temporary',
  'tend', 'tendency', 'tender', 'tension', 'terminal', 'territory',
  'theory', 'therapy', 'therefore', 'thorough', 'threat', 'thrive',
  'tidy', 'tissue', 'title', 'tone', 'topic', 'torture', 'trace',
  'tradition', 'transfer', 'transform', 'transition', 'translate',
  'transport', 'treasure', 'trend', 'trial', 'triumph', 'tropical',
  'trust', 'typical', 'ultimate', 'undergo', 'undertake', 'unemployment',
  'uniform', 'union', 'unique', 'universal', 'update', 'upgrade',
  'upper', 'urban', 'urge', 'urgent', 'utilize', 'vacant',
  'vague', 'valid', 'value', 'vanish', 'variety', 'vehicle',
  'venture', 'version', 'victim', 'violence', 'virtue', 'visible',
  'vision', 'vital', 'vivid', 'volume', 'voluntary', 'vote',
  'wage', 'waste', 'wealth', 'weapon', 'welfare', 'whisper',
  'wicked', 'widespread', 'wisdom', 'withdraw', 'witness',
  'worship', 'worthwhile', 'wound', 'yield', 'zone',
]);

// CET-6 words (higher level)
const CET6_WORDS = new Set([
  'abnormal', 'abolish', 'abortion', 'abrupt', 'absurd', 'abundance', 'academy',
  'accessory', 'accommodate', 'accumulate', 'activate', 'addict', 'adhesive',
  'adjacent', 'adjoin', 'administer', 'adolescent', 'advent', 'adverse',
  'affiliate', 'afflict', 'aggravate', 'aggregate', 'agitate', 'allege',
  'alleviate', 'allocate', 'alloy', 'alternate', 'ambiguous', 'amend',
  'amend', 'ample', 'analogy', 'anonymous', 'antenna', 'anticipate',
  'apparatus', 'appease', 'appendix', 'applaud', 'apprentice', 'apt',
  'arc', 'arch', 'arena', 'arid', 'aristocrat', 'armor', 'array',
  'arrogant', 'artery', 'articulate', 'ascend', 'ascertain', 'aspiration',
  'assassinate', 'assault', 'assemble', 'assert', 'assimilate', 'asteroid',
  'astound', 'asylum', 'atlas', 'attic', 'attribute', 'auction',
  'audit', 'auditorium', 'augment', 'authentic', 'autonomy', 'avail',
  'avert', 'aviation', 'baffle', 'bald', 'ballet', 'banquet',
  'barren', 'bazaar', 'benchmark', 'benevolent', 'benign', 'besiege',
  'bizarre', 'blaze', 'bleak', 'bliss', 'blunder', 'blunt',
  'boycott', 'brace', 'brew', 'brisk', 'brood', 'browse',
  'brutal', 'bubble', 'bucket', 'budget', 'bully', 'bureaucracy',
  'burial', 'bust', 'calamity', 'calcium', 'caliber', 'calligraphy',
  'cannon', 'canvas', 'cape', 'cardinal', 'catastrophe', 'cater',
  'cathedral', 'cavalry', 'cemetery', 'cereal', 'chancellor', 'chaos',
  'characterize', 'charter', 'cherish', 'cholesterol', 'chronic', 'circulation',
  'civic', 'clamp', 'clan', 'clarity', 'clash', 'clergy',
  'cling', 'cluster', 'clutch', 'coalition', 'coarse', 'cocaine',
  'cognitive', 'coherent', 'coincide', 'collaborate', 'collide', 'colonial',
  'column', 'combat', 'commemorate', 'commence', 'commission', 'commodity',
  'commonplace', 'communal', 'commute', 'compact', 'comparable', 'compartment',
  'compatible', 'compel', 'compensate', 'competent', 'compile', 'complement',
  'complexity', 'comply', 'composite', 'compulsory', 'concede', 'conceive',
  'concession', 'confer', 'confidential', 'conform', 'confront', 'congregation',
  'conscience', 'consecutive', 'consensus', 'consequent', 'conserve', 'console',
  'consolidate', 'conspicuous', 'conspiracy', 'constitute', 'constrain', 'consultant',
  'contemplate', 'contend', 'contingent', 'contradict', 'controversy', 'converge',
  'conversion', 'cooperative', 'cordial', 'corporate', 'correlate', 'correspondence',
  'corrode', 'corrupt', 'cosmic', 'cosmopolitan', 'counsel', 'counterpart',
  'courtesy', 'coverage', 'cradle', 'cripple', 'criterion', 'crucial',
  'cruise', 'crush', 'cue', 'culminate', 'cumulative', 'curb',
  'curriculum', 'customary', 'cylinder', 'cynical', 'dairy', 'dazzle',
  'deadly', 'dean', 'debut', 'decree', 'dedication', 'deem',
  'default', 'defect', 'deficiency', 'deficit', 'defy', 'degenerate',
  'deliberately', 'delicate', 'demolish', 'denounce', 'density', 'depict',
  'deplete', 'deploy', 'depreciate', 'deputy', 'descendant', 'designate',
  'despatch', 'destined', 'detain', 'detector', 'deviate', 'devour',
  'diagnose', 'differentiate', 'diffuse', 'dilemma', 'dilute', 'dimension',
  'diminish', 'diplomatic', 'directory', 'disable', 'discern', 'discharge',
  'discourse', 'discrete', 'discriminate', 'displace', 'dispose', 'disposition',
  'disrupt', 'dissipate', 'dissolve', 'distill', 'distort', 'distribute',
  'disturbance', 'diverge', 'dividend', 'doctrine', 'documentary', 'domain',
  'dome', 'donate', 'doom', 'drainage', 'drastic', 'drawback',
  'drought', 'dual', 'dubious', 'duplicate', 'dwell', 'dynamics',
  'eccentric', 'eclipse', 'ecology', 'editorial', 'eject', 'elapse',
  'electrician', 'elevate', 'elicit', 'eligible', 'elite', 'eloquent',
  'embark', 'embed', 'embody', 'emigrate', 'emission', 'emphasize',
  'empirical', 'enact', 'encompass', 'endurance', 'enforce', 'enhance',
  'enlighten', 'enrich', 'ensemble', 'entity', 'entrepreneur', 'envision',
  'epidemic', 'epoch', 'equator', 'erect', 'erosion', 'erroneous',
  'erupt', 'escalate', 'escort', 'essence', 'estate', 'eternal',
  'ethnic', 'evacuate', 'evaluate', 'evaporate', 'evoke', 'exaggerate',
  'exceedingly', 'exception', 'exclusive', 'execute', 'exempt', 'exile',
  'exotic', 'expedition', 'expel', 'expenditure', 'expertise', 'expire',
  'explicit', 'exploit', 'exposition', 'exquisite', 'extinct', 'extract',
  'extravagant', 'fabricate', 'facet', 'facilitate', 'faction', 'faculty',
  'famine', 'fascinate', 'feat', 'federation', 'feeble', 'feminine',
  'fertility', 'fierce', 'fixture', 'flap', 'flaw', 'flee',
  'fling', 'flip', 'fluctuate', 'flush', 'foam', 'foil',
  'foremost', 'foresee', 'formidable', 'formulate', 'fort', 'fossil',
  'foster', 'fracture', 'fragile', 'freight', 'fringe', 'frontier',
  'frustrate', 'fugitive', 'fuse', 'futile', 'galaxy', 'gamble',
  'gauge', 'gaze', 'generic', 'genetic', 'geology', 'gigantic',
  'glacier', 'glamour', 'gland', 'glare', 'gleam', 'glide',
  'glimpse', 'glitter', 'gloom', 'gorgeous', 'gossip', 'governance',
  'gracious', 'gradient', 'granite', 'graphic', 'gravel', 'grieve',
  'grin', 'grip', 'groan', 'gross', 'grudge', 'guardian',
  'habitat', 'halt', 'hamper', 'handicap', 'harassment', 'hardy',
  'haste', 'haunt', 'haven', 'hazard', 'hemisphere', 'herb',
  'heritage', 'hierarchy', 'hinder', 'hinge', 'homogeneous', 'horizon',
  'hormone', 'hospitable', 'hostility', 'hover', 'humidity', 'humiliate',
  'hybrid', 'hydrogen', 'hygiene', 'hypothesis', 'hysterical', 'ideology',
  'idle', 'illuminate', 'illusion', 'immense', 'immerse', 'immune',
  'impair', 'impart', 'imperative', 'imperial', 'impetus', 'implant',
  'implement', 'implicit', 'impulse', 'inadequate', 'incentive', 'incidence',
  'inclusive', 'incorporate', 'incur', 'indefinite', 'indicator', 'indigenous',
  'indignant', 'indispensable', 'induce', 'indulge', 'inertia', 'inevitable',
  'infamous', 'infant', 'inflict', 'ingenious', 'inhabit', 'inherent',
  'inhibit', 'initiate', 'inject', 'inland', 'inn', 'innovation',
  'innumerable', 'input', 'insert', 'insight', 'insomnia', 'inspection',
  'instability', 'installment', 'instantaneous', 'instrumental', 'insulate',
  'intact', 'integral', 'integrate', 'integrity', 'intellect', 'intensify',
  'intent', 'interact', 'intercourse', 'interface', 'interfere', 'interim',
  'interior', 'intermediate', 'interpretation', 'intervention', 'intimate',
  'intricate', 'intrinsic', 'intuition', 'invalid', 'invaluable', 'invariable',
  'inventory', 'invert', 'irony', 'irrational', 'irrelevant', 'irrigation',
  'irritate', 'isolate', 'ivory', 'jealous', 'jeopardize', 'journalism',
  'judicial', 'junction', 'jury', 'juvenile', 'kidnap', 'kinetic',
  'knack', 'label', 'labyrinth', 'landmark', 'laser', 'lateral',
  'latitude', 'latter', 'launch', 'lawsuit', 'layout', 'lease',
  'legacy', 'legislation', 'legitimate', 'leisure', 'lever', 'levy',
  'liability', 'lieutenant', 'likelihood', 'limb', 'linear', 'linger',
  'literacy', 'literal', 'litter', 'lobby', 'locomotive', 'locus',
  'logistics', 'longitude', 'loom', 'loophole', 'lottery', 'lubricate',
  'lucrative', 'lumber', 'luminous', 'lunar', 'lure', 'magistrate',
  'magnet', 'magnitude', 'mainstream', 'malicious', 'mandate', 'manifest',
  'manipulate', 'manuscript', 'marathon', 'marital', 'maritime', 'martial',
  'masculine', 'massacre', 'mature', 'meadow', 'mechanism', 'mediate',
  'meditate', 'medieval', 'membrane', 'memoir', 'memorandum', 'menace',
  'mercury', 'merge', 'metabolism', 'metaphor', 'methodology', 'metropolitan',
  'microprocessor', 'midst', 'migrate', 'milestone', 'militant', 'millennium',
  'mingle', 'miniature', 'ministry', 'minority', 'miracle', 'mischief',
  'misery', 'missionary', 'mobility', 'mock', 'module', 'momentum',
  'monarchy', 'monastery', 'monopoly', 'mortgage', 'motel', 'motive',
  'mould', 'mourn', 'multilateral', 'multitude', 'municipal', 'murmur',
  'mute', 'myriad', 'myth', 'naive', 'narrative', 'nasty',
  'navigation', 'necessitate', 'negotiate', 'neutron', 'niche', 'nitrogen',
  'nominal', 'nominate', 'nonetheless', 'norm', 'notable', 'notify',
  'notorious', 'novelty', 'nucleus', 'null', 'numerical', 'nutrition',
  'oath', 'obesity', 'obligatory', 'obscure', 'obsolete', 'obstruct',
  'offspring', 'olive', 'opaque', 'optimum', 'option', 'orbit',
  'orient', 'orthodox', 'outbreak', 'outfit', 'outlet', 'output',
  'outrage', 'outskirts', 'overhead', 'overlap', 'overrule', 'oversee',
  'overturn', 'overwhelm', 'oxide', 'ozone', 'paddle', 'pamphlet',
  'pandemic', 'paradigm', 'paradox', 'parallel', 'parameter', 'paralyze',
  'paramount', 'parasite', 'parliament', 'partial', 'partition', 'pastime',
  'patent', 'pathetic', 'patriot', 'patrol', 'patron', 'pave',
  'payload', 'peasant', 'peculiarity', 'pedal', 'peer', 'penalty',
  'penetrate', 'peril', 'periodical', 'peripheral', 'perish', 'permeate',
  'permit', 'perpetual', 'perplex', 'persecute', 'persistent', 'personnel',
  'petition', 'petroleum', 'pharmacy', 'physiology', 'pilgrim', 'pillar',
  'pinch', 'pioneer', 'pipeline', 'pirate', 'plague', 'plaintiff',
  'plantation', 'plaster', 'plateau', 'plea', 'plead', 'pledge',
  'plunge', 'poll', 'polymer', 'ponder', 'pope', 'portfolio',
  'portion', 'portray', 'postpone', 'posture', 'potent', 'potential',
  'practitioner', 'prairie', 'preach', 'precaution', 'precede', 'precipitate',
  'preclude', 'predecessor', 'predominant', 'prefabricate', 'preferable',
  'premise', 'premium', 'prescribe', 'preside', 'prestige', 'presume',
  'prevail', 'prevalent', 'prey', 'priest', 'prime', 'primitive',
  'privilege', 'probe', 'proceeding', 'proclaim', 'procure', 'profile',
  'profound', 'prohibit', 'projection', 'proliferate', 'prolong', 'prominent',
  'prone', 'propaganda', 'propagate', 'propel', 'proponent', 'proposition',
  'prose', 'prosecute', 'prospective', 'prosper', 'protest', 'protocol',
  'prototype', 'provoke', 'proximity', 'prudent', 'purify', 'purity',
  'pursuit', 'qualitative', 'quantitative', 'quench', 'quest', 'quorum',
  'quota', 'rack', 'radiate', 'radical', 'rage', 'raid',
  'rally', 'ramp', 'ranch', 'random', 'ratify', 'rationale',
  'realm', 'reap', 'reassure', 'rebellion', 'recession', 'recipient',
  'recite', 'reckon', 'reconcile', 'reconstruction', 'recruit', 'recur',
  'recycle', 'redundant', 'referee', 'refine', 'refrain', 'refugee',
  'refund', 'refute', 'regime', 'reign', 'relay', 'reliance',
  'relic', 'reluctant', 'remainder', 'remnant', 'renaissance', 'render',
  'renounce', 'renovate', 'repay', 'repeal', 'repertoire', 'replenish',
  'replica', 'reproach', 'republic', 'reputable', 'requisite', 'resemble',
  'resent', 'reside', 'residual', 'resign', 'resilient', 'resonate',
  'respective', 'restoration', 'retail', 'retard', 'retention', 'retort',
  'retrieve', 'retrospect', 'revelation', 'revenge', 'revenue', 'revert',
  'revive', 'revolve', 'rigorous', 'riot', 'ritual', 'robust',
  'rot', 'rotary', 'rotate', 'routine', 'royalty', 'rupture',
  'sacred', 'safeguard', 'salvage', 'sanction', 'sanctuary', 'saturate',
  'savage', 'scandal', 'scarce', 'scenario', 'scent', 'sceptical',
  'scorn', 'scramble', 'scrap', 'scrutiny', 'sculpture', 'secular',
  'segment', 'segregate', 'sensation', 'sentiment', 'serial', 'serene',
  'shaft', 'shatter', 'shed', 'sheer', 'shelter', 'sheriff',
  'shield', 'shipment', 'shuttle', 'siege', 'skeptical', 'skeleton',
  'skip', 'skull', 'slaughter', 'slavery', 'slot', 'slump',
  'smash', 'smuggle', 'snap', 'snatch', 'soar', 'socket',
  'solicitor', 'solidarity', 'solitary', 'soluble', 'solution', 'sovereign',
  'sow', 'spark', 'specification', 'specimen', 'spectacle', 'spectacular',
  'spectator', 'speculate', 'sphere', 'spiral', 'splash', 'sponge',
  'spontaneous', 'spouse', 'squad', 'stability', 'stagger', 'stake',
  'stale', 'stall', 'stance', 'staple', 'statesman', 'static',
  'stationary', 'statistical', 'statute', 'steer', 'stem', 'stereotype',
  'steward', 'stimulus', 'stipulate', 'stock', 'strand', 'strap',
  'stray', 'streamline', 'stride', 'strife', 'striking', 'strip',
  'strive', 'stubborn', 'stumble', 'stun', 'sturdy', 'subjective',
  'subscribe', 'subsidy', 'substantial', 'substitute', 'subtle', 'suburban',
  'successor', 'sue', 'suffice', 'suite', 'sulfur', 'summit',
  'summon', 'superb', 'superfluous', 'supplement', 'suppress', 'surge',
  'surplus', 'surrender', 'surveillance', 'susceptible', 'suspension',
  'suspicion', 'sustain', 'swamp', 'swarm', 'swerve', 'syndrome',
  'synthesis', 'tablet', 'tackle', 'tact', 'tactic', 'tan',
  'tangle', 'tariff', 'taxpayer', 'tease', 'tempo', 'tenant',
  'tentative', 'terminate', 'terrain', 'terrific', 'terrify', 'territory',
  'testify', 'testimony', 'texture', 'theft', 'theme', 'therapy',
  'thereafter', 'thermal', 'thesis', 'thorn', 'threshold', 'thrust',
  'tick', 'tile', 'timber', 'tissue', 'tolerant', 'toll',
  'topple', 'torment', 'torture', 'toss', 'toxic', 'tract',
  'trademark', 'tragic', 'trait', 'transaction', 'transcript', 'transit',
  'transmitter', 'transplant', 'trauma', 'traverse', 'treaty', 'tremendous',
  'tribe', 'tribute', 'trigger', 'triple', 'triumph', 'trivial',
  'tropic', 'tumble', 'tunnel', 'turbine', 'turbulent', 'turnover',
  'tutor', 'twilight', 'twist', 'tyranny', 'unanimous', 'undergraduate',
  'undermine', 'undertake', 'unfold', 'unify', 'unanimous', 'update',
  'upgrade', 'uphold', 'upright', 'uproar', 'uproot', 'upward',
  'urban', 'urge', 'utilize', 'utmost', 'utter', 'vacancy',
  'vaccine', 'valid', 'valor', 'vanish', 'variable', 'vegetation',
  'veil', 'velocity', 'vendor', 'ventilate', 'venture', 'venue',
  'verbal', 'verdict', 'verify', 'versatile', 'verse', 'versus',
  'veto', 'vicinity', 'vigor', 'violate', 'virgin', 'virtual',
  'visualize', 'vital', 'vivid', 'volatile', 'volley', 'voluntary',
  'vow', 'vulnerable', 'wade', 'wallet', 'ward', 'warehouse',
  'warfare', 'warrant', 'waterproof', 'weary', 'weave', 'weld',
  'wholesale', 'wicked', 'wield', 'wilderness', 'wit', 'withdraw',
  'withhold', 'withstand', 'witness', 'workshop', 'worship', 'wrap',
  'wreck', 'wrestle', 'wring', 'yacht', 'yearn', 'yield',
  'zeal', 'zenith', 'zinc', 'zone',
]);

// IELTS specific words
const IELTS_WORDS = new Set([
  'accommodation', 'achievement', 'acquisition', 'adaptation', 'adequate',
  'advancement', 'advertising', 'agriculture', 'alternative', 'analysis',
  'anthropology', 'apparatus', 'application', 'assessment', 'assignment',
  'atmosphere', 'autonomy', 'biodiversity', 'breakthrough', 'bureaucracy',
  'carbon', 'catastrophe', 'chronological', 'circumstance', 'civilization',
  'classification', 'collaboration', 'commercial', 'commodity', 'communicate',
  'companion', 'comparison', 'compensate', 'competence', 'compilation',
  'complement', 'compliance', 'comprehensive', 'compulsory', 'conceive',
  'concentration', 'concrete', 'conflict', 'conscience', 'conservation',
  'considerably', 'consistency', 'consolidate', 'constitute', 'consultant',
  'consumption', 'contemporary', 'controversy', 'conventional', 'conversion',
  'cooperation', 'correlation', 'correspondence', 'criteria', 'curriculum',
  'deficiency', 'deliberate', 'demographic', 'deprivation', 'derivative',
  'deterioration', 'diagnosis', 'discrepancy', 'discrimination', 'displacement',
  'disposal', 'distinct', 'distribution', 'diversity', 'documentation',
  'domestic', 'dominance', 'drought', 'duration', 'dynamic',
  'ecological', 'effectiveness', 'elaborate', 'electoral', 'elimination',
  'embargo', 'emission', 'empirical', 'encompass', 'endorse',
  'enforcement', 'enhancement', 'enterprise', 'equilibrium', 'equivalent',
  'erosion', 'essential', 'establishment', 'evaluation', 'evidence',
  'evolution', 'exaggerate', 'exceed', 'exception', 'exhaustion',
  'expansion', 'exploitation', 'exposure', 'extinction', 'extraction',
  'facilitate', 'feasible', 'flexibility', 'fluctuation', 'formation',
  'formulation', 'foundation', 'fragment', 'framework', 'function',
  'generation', 'genetic', 'geographical', 'globalization', 'governance',
  'guideline', 'habitat', 'hierarchy', 'humanitarian', 'hypothesis',
  'identification', 'ideology', 'immigration', 'implementation', 'implication',
  'imposition', 'incentive', 'incidence', 'incorporation', 'indicator',
  'indigenous', 'inequality', 'infrastructure', 'inhabitant', 'initiative',
  'innovation', 'inspection', 'institution', 'integration', 'intellectual',
  'interaction', 'interdependence', 'interpretation', 'intervention', 'introduction',
  'investigation', 'isolation', 'justification', 'laboratory', 'legislation',
  'legitimate', 'liberalization', 'lifestyle', 'livelihood', 'maintenance',
  'malnutrition', 'manipulation', 'mechanism', 'methodology', 'migration',
  'mitigation', 'modification', 'monitoring', 'monopoly', 'mortality',
  'negotiation', 'nutrition', 'obesity', 'objective', 'obligation',
  'occupation', 'offspring', 'optimism', 'orientation', 'outcomes',
  'overwhelming', 'participation', 'partnership', 'perception', 'phenomenon',
  'philosophy', 'pollutant', 'popularity', 'portfolio', 'potential',
  'practitioner', 'precaution', 'predominantly', 'preservation', 'principle',
  'priority', 'probability', 'procedure', 'proportion', 'prospect',
  'provision', 'publication', 'qualification', 'questionnaire', 'recession',
  'recognition', 'reconstruction', 'reduction', 'refinement', 'reform',
  'regulation', 'rehabilitation', 'reinforcement', 'relevance', 'reliability',
  'remuneration', 'representation', 'reproduction', 'resolution', 'resource',
  'restoration', 'restriction', 'retention', 'revelation', 'revenue',
  'revolution', 'sanction', 'scenario', 'scholarship', 'sector',
  'segregation', 'simulation', 'sophistication', 'specification', 'sponsorship',
  'stability', 'standardization', 'stimulus', 'strategy', 'subsidy',
  'substitution', 'supplement', 'sustainability', 'syndrome', 'synthesis',
  'tariff', 'tendency', 'termination', 'threshold', 'tolerance',
  'transformation', 'transition', 'transmission', 'transparency', 'trend',
  'trigger', 'undergo', 'unprecedented', 'urbanization', 'utilization',
  'validation', 'variable', 'violation', 'welfare',
]);

function extractCategoryFromDefinition(definition: string): WordCategory {
  const d = definition.trim().toLowerCase();
  if (/^v\.|\/ v\.|\/v\./.test(d)) return 'verb';
  if (/^n\.|\/ n\.|\/n\./.test(d)) return 'noun';
  if (/^adj\.|\/ adj\.|\/adj\./.test(d)) return 'adj';
  if (/^adv\.|\/ adv\.|\/adv\./.test(d)) return 'adv';
  if (/^prep\.|\/ prep\.|\/prep\./.test(d)) return 'prep';
  if (/^pron\.|\/ pron\.|\/pron\./.test(d)) return 'pron';
  if (/^conj\.|\/ conj\.|\/conj\./.test(d)) return 'conj';
  if (/^det\.|\/ det\.|\/det\./.test(d)) return 'det';
  if (/^num\.|\/ num\.|\/num\./.test(d)) return 'num';
  if (/^int\.|\/ int\.|\/int\./.test(d)) return 'int';
  if (/^art\.|\/ art\.|\/art\./.test(d)) return 'art';
  return 'other';
}

function guessCategoryBySuffix(word: string): WordCategory {
  if (word.endsWith('ly')) return 'adv';
  if (/(?:tion|sion|ment|ness|ity|ance|ence|ism|ist|dom|ship|hood)$/.test(word)) return 'noun';
  if (/(?:ful|less|ous|ive|able|ible|al|ial|ical|ent|ant)$/.test(word)) return 'adj';
  if (/(?:ing|ed|ize|ify|ate|en)$/.test(word) && word.length > 4) return 'verb';
  return 'other';
}

function extractPosLabel(definition: string): string | null {
  const d = definition.trim();
  const match = d.match(/^(v\.|n\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.|int\.|art\.)/);
  return match ? match[1].replace('.', '') : null;
}

/**
 * Determine exam level for a word.
 */
function getExamLevel(word: string): ExamLevel | null {
  const w = word.toLowerCase();
  if (IELTS_WORDS.has(w)) return '雅思';
  if (CET6_WORDS.has(w)) return '六级';
  if (CET4_WORDS.has(w)) return '四级';
  // Words in local-dict but not in any exam list are likely basic
  if (getLocalDictEntry(w)) return null;
  // Unknown words are likely higher level
  return null;
}

/**
 * Check if a word is a valid English word (not a number, abbreviation, etc.)
 */
function isValidWord(word: string): boolean {
  const w = word.toLowerCase().trim();
  // Must be at least 2 chars
  if (w.length < 2) return false;
  // Must contain only letters (allow hyphen and apostrophe)
  if (!/^[a-z][a-z'-]*[a-z]$|^[a-z][a-z]$/i.test(w)) return false;
  // Must not be all same letter
  if (/^(.)\1+$/.test(w)) return false;
  // Must not be a number
  if (/^\d+$/.test(w)) return false;
  // Must not be a contraction fragment
  if (STOP_WORDS.has(w)) return false;
  return true;
}

export function classifyWord(rawWord: string): WordClassResult {
  const cleaned = rawWord.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();

  if (!cleaned || cleaned.length < 2) {
    return { ...CATEGORY_CONFIG.other, category: 'other', isKeyVocab: false };
  }

  const entry = getLocalDictEntry(cleaned);
  if (entry) {
    const category = extractCategoryFromDefinition(entry.definition);
    const config = CATEGORY_CONFIG[category];
    return {
      category,
      label: config.label,
      color: config.color,
      bgColor: config.bgColor,
      isKeyVocab: KEY_VOCAB_CATEGORIES.has(category) && !STOP_WORDS.has(cleaned),
    };
  }

  const category = guessCategoryBySuffix(cleaned);
  const config = CATEGORY_CONFIG[category];
  return {
    category,
    label: config.label,
    color: config.color,
    bgColor: config.bgColor,
    isKeyVocab: !STOP_WORDS.has(cleaned),
  };
}

/**
 * Extract vocab from subtitles grouped by learning priority.
 *
 * Priority rules:
 * - **core**: appears >= 2 times AND is a valid word → must-learn
 * - **advanced**: appears 1 time, NOT a basic/stop word, NOT in local-dict basic list → worth learning
 * - **basic**: in local-dict AND in BASIC_WORDS set → already known, skip
 */
export function getVideoVocab(subtitles: { text: string }[]): VideoVocabEntry[] {
  const wordMap = new Map<string, { count: number; firstIndex: number }>();

  for (let i = 0; i < subtitles.length; i++) {
    const words = subtitles[i].text.split(/\s+/);
    for (const w of words) {
      const cleaned = w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();
      if (!isValidWord(cleaned)) continue;

      const existing = wordMap.get(cleaned);
      if (existing) {
        existing.count++;
      } else {
        wordMap.set(cleaned, { count: 1, firstIndex: i });
      }
    }
  }

  const entries: VideoVocabEntry[] = [];

  wordMap.forEach((info, word) => {
    const localEntry = getLocalDictEntry(word);

    let definition: string | null = null;
    let pos: string | null = null;

    if (localEntry) {
      definition = `${localEntry.phonetic}\n${localEntry.definition}`;
      pos = extractPosLabel(localEntry.definition);
    }

    const examLevel = getExamLevel(word);

    let priority: LearningPriority;
    if (BASIC_WORDS.has(word)) {
      // Very common words → basic, even if they appear multiple times
      priority = info.count >= 3 ? 'core' : 'basic';
    } else if (info.count >= 2) {
      // Repeated words → core
      priority = 'core';
    } else if (localEntry && !BASIC_WORDS.has(word)) {
      // Has dict entry but not basic → advanced
      priority = 'advanced';
    } else {
      // No dict entry → likely advanced/uncommon
      priority = 'advanced';
    }

    entries.push({
      word,
      count: info.count,
      priority,
      firstIndex: info.firstIndex,
      definition,
      pos,
      examLevel,
    });
  });

  // Sort: core first (by count desc), then advanced (alpha), then basic (alpha)
  const priorityOrder: Record<LearningPriority, number> = { core: 0, advanced: 1, basic: 2 };
  entries.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    if (a.priority === 'core' && b.priority === 'core') {
      return b.count - a.count;
    }
    return a.word.localeCompare(b.word);
  });

  return entries;
}

/** Legacy function kept for backward compat — now delegates to getVideoVocab */
export function getKeyVocabFromSubtitles(subtitles: { text: string }[]): Map<string, WordClassResult & { count: number }> {
  const vocabMap = new Map<string, WordClassResult & { count: number }>();

  for (const sub of subtitles) {
    const words = sub.text.split(/\s+/);
    for (const w of words) {
      const cleaned = w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();
      if (!cleaned || cleaned.length < 3 || STOP_WORDS.has(cleaned)) continue;

      const existing = vocabMap.get(cleaned);
      if (existing) {
        existing.count++;
      } else {
        const result = classifyWord(cleaned);
        if (result.isKeyVocab) {
          vocabMap.set(cleaned, { ...result, count: 1 });
        }
      }
    }
  }

  return vocabMap;
}

export { CATEGORY_CONFIG, STOP_WORDS };
