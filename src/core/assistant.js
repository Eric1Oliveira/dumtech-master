// DUM AI — interpretação das perguntas (regras locais, sem IA paga e sem enviar nada para fora).
// Transforma o texto em { intent, flags, terms }: o assunto, os filtros pedidos e o que sobrou
// para procurar por nome (cliente, projeto, produto…). Quem responde é services/assistant.js.

import { normalize } from '../shared/utils/format.js';

/**
 * Assuntos e as palavras que os indicam (já sem acento). Vence quem aparece primeiro na frase.
 * @type {{ intent: string, words: string[] }[]}
 */
const SUBJECTS = [
  { intent: 'tasks', words: ['tarefa', 'pendencia', 'a fazer', 'to-do', 'todo'] },
  { intent: 'proposals', words: ['proposta', 'orcamento', 'cotacao'] },
  { intent: 'projects', words: ['projeto', 'entrega', 'implantac'] },
  { intent: 'customers', words: ['cliente', 'lead', 'carteira', 'cnpj', 'cpf'] },
  { intent: 'products', words: ['produto', 'sistema', 'catalogo', 'mensalidade'] },
  { intent: 'infra', words: ['infra', 'dominio', 'hospedagem', 'servidor', 'vencimento', 'vence', 'renova', 'fora do ar', 'no ar', 'monitor', 'uptime', 'custo'] },
  { intent: 'members', words: ['membro', 'equipe', 'time', 'colaborador', 'usuario', 'pessoas', 'papel', 'papeis', 'administrador', 'proprietario', 'gestor', 'convite'] },
  { intent: 'activity', words: ['atividade', 'o que mudou', 'quem fez', 'historico', 'auditoria', 'ultimas acoes', 'aconteceu', 'alterac'] },
  { intent: 'notifications', words: ['aviso', 'notificac', 'alerta'] },
  { intent: 'automations', words: ['automac', 'rotina', 'lembrete'] },
  { intent: 'vault', words: ['senha', 'cofre', 'segredo', 'credencia', 'vault', 'token', 'chave de api'] },
  { intent: 'documents', words: ['documento', 'nota', 'arquivo', 'workspace', 'anotac', 'caderno', 'pagina', 'reuniao', 'ata'] },
  { intent: 'analytics', words: ['analytics', 'evento', 'uso do', 'acessos', 'metrica'] },
  { intent: 'finance', words: ['faturamento', 'lucro', 'receita', 'financeiro', 'financesolux', 'mrr', 'dinheiro', 'caixa'] },
];

const SUMMARY = ['resumo', 'visao geral', 'como estamos', 'panorama', 'situacao geral', 'como esta a empresa', 'status geral', 'como vai'];
const STRONG_HELP = ['ajuda', 'o que voce faz', 'o que voce sabe', 'como funciona', 'como usar', 'comandos', 'exemplos'];
const HELP = ['ajuda', 'o que voce faz', 'o que voce sabe', 'comandos', 'como funciona', 'como usar', 'exemplos', 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'e ai'];

/** Filtros reconhecidos (aplicados conforme o assunto). */
const FLAGS = {
  mine: ['minha', 'minhas', 'meu', 'meus', 'comigo', 'pra mim', 'para mim'],
  late: ['atrasad', 'vencid', 'estourad', 'passou do prazo'],
  today: ['hoje', 'para hoje', 'do dia'],
  week: ['semana', '7 dias', 'sete dias'],
  month: ['mes', '30 dias', 'trinta dias'],
  active: ['ativo', 'ativa', 'em andamento', 'andamento', 'rodando'],
  lead: ['lead'],
  inactive: ['inativo', 'inativa', 'desativad'],
  open: ['aberta', 'aberto', 'pendente', 'em aberto'],
  draft: ['rascunho'],
  sent: ['enviada', 'enviado', 'aguardando'],
  accepted: ['aceita', 'aceito', 'fechad', 'ganha'],
  rejected: ['recusad', 'perdid', 'negad'],
  done: ['concluid', 'feita', 'feito', 'finalizad', 'entregue'],
  paused: ['pausad', 'parad'],
  down: ['fora do ar', 'caiu', 'offline', 'indisponivel'],
  renewals: ['vence', 'vencimento', 'renova', 'expira'],
  cost: ['custo', 'quanto custa', 'gasto', 'quanto pago'],
  count: ['quantos', 'quantas', 'numero de', 'total de', 'qtd'],
  value: ['valor', 'quanto vale', 'total em', 'soma'],
};

/** Palavras que não ajudam a achar um registro pelo nome. */
const STOPWORDS = new Set(
  ('a o as os e é eh de da do das dos em no na nos nas num numa para pra pro por com sem que qual quais quem como onde quando ' +
    'me mostra mostre mostrar lista liste listar ver veja quero queria saber tem temos tenho ha existe existem um uma uns umas ' +
    'sobre informacoes informacao info detalhe detalhes esta estao sao ser foi vai sobre isso essa esse este esta todos todas ' +
    'tudo meu minha meus minhas seu sua ja ainda agora hoje mes semana dia dias quanto quantos quantas valor total abrir abre ir ' +
    'situacao status ativo ativa ativos ativas aberta abertas aberto abertos atrasada atrasadas atrasado atrasados lead leads ' +
    'inativo inativos inativa inativas enviada enviadas aceita aceitas recusada recusadas rascunho rascunhos concluida concluidas ' +
    'feita feitas pausado pausados vence vencem vencimento vencimentos custo custa fora ar quem responsavel dono dados ' +
    'cadastrado cadastrados cadastrada cadastradas preciso fazer pendente pendentes andamento').split(' '),
);

/**
 * @typedef {Object} ParsedQuestion
 * @property {string} intent      assunto (tasks, customers…), 'summary', 'help' ou 'search'
 * @property {Set<string>} flags  filtros pedidos (late, mine, active…)
 * @property {string} terms       o que sobrou para procurar por nome
 * @property {string} text        pergunta normalizada
 */

/**
 * Posição da palavra na frase (Infinity = ausente). Frases e palavras curtas casam inteiras;
 * as demais casam pelo começo ("atrasad" pega "atrasadas").
 * @param {string} text @param {string} word
 */
const position = (text, word) => {
  const whole = word.includes(' ') || word.length <= 3;
  const i = ` ${text} `.indexOf(whole ? ` ${word} ` : ` ${word}`);
  return i < 0 ? Infinity : i;
};

/**
 * @param {string} question
 * @returns {ParsedQuestion}
 */
export function parseQuestion(question) {
  const text = normalize(question).replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  let best = { intent: '', at: Infinity };
  for (const s of SUBJECTS) {
    for (const w of s.words) {
      const at = position(text, w);
      if (at < best.at) best = { intent: s.intent, at };
    }
  }
  /** @type {Set<string>} */
  const flags = new Set();
  for (const [flag, words] of Object.entries(FLAGS)) if (words.some((w) => position(text, w) < Infinity)) flags.add(flag);

  const subjectWords = SUBJECTS.flatMap((s) => s.words);
  const terms = text
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !subjectWords.some((sw) => !sw.includes(' ') && w.startsWith(sw)))
    .join(' ');

  let intent = STRONG_HELP.some((w) => position(text, w) < Infinity) ? 'help' : best.intent;
  if (!intent && SUMMARY.some((w) => position(text, w) < Infinity)) intent = 'summary';
  if (!intent && (!text || HELP.some((w) => position(text, w) < Infinity))) intent = 'help';
  if (!intent) intent = 'search';
  return { intent, flags, terms, text };
}

/**
 * O nome do registro bate com o que foi pedido? Todas as palavras pedidas aparecem no nome
 * (ou o nome inteiro aparece na pergunta).
 * @param {string} name
 * @param {string} terms
 * @param {string} [text] pergunta normalizada completa
 */
export function nameMatches(name, terms, text = '') {
  const n = normalize(name);
  if (!n) return false;
  if (text && n.length >= 3 && ` ${text} `.includes(` ${n} `)) return true;
  const words = terms.split(' ').filter((w) => w.length > 1);
  return words.length > 0 && words.every((w) => n.includes(w));
}

/** Perguntas de exemplo (aparecem como atalhos na conversa). */
export const EXAMPLES = [
  'Resumo da empresa',
  'Minhas tarefas',
  'Tarefas atrasadas',
  'Propostas abertas',
  'Clientes ativos',
  'O que vence este mês?',
  'Projetos em andamento',
  'Quem faz parte da equipe?',
  'O que mudou hoje?',
];
