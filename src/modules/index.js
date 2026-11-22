// Registro de módulos. Sidebar, busca (Ctrl+K), rotas e permissões leem daqui.
// Menu: 5 áreas do dia a dia + ferramentas. Módulos com `hidden` têm rota e aparecem na busca,
// mas não no menu (viraram seções de outras telas).

/**
 * @typedef {Object} ModuleSection
 * @property {string} id
 * @property {string} name
 * @property {string} [permission]
 * @property {string} [keywords]   termos extras para a busca
 */

/**
 * @typedef {Object} ModuleContext
 * @property {HTMLElement} root       área de conteúdo da tela
 * @property {import('../core/router.js').Route} route
 * @property {ModuleDef} module
 * @property {AbortSignal} signal     abortado ao sair da tela (use em addEventListener)
 */

/**
 * @typedef {(ctx: ModuleContext) => void | Promise<void>} ModuleRender
 */

/**
 * @typedef {Object} ModuleDef
 * @property {string} id            rota: #/id
 * @property {string} code          sigla de 3 letras (atalho na busca Ctrl+K)
 * @property {import('../shared/components/icons.js').IconName} icon   ícone de linha (sidebar e topo)
 * @property {string} name
 * @property {string} group         '' = área principal (sem título no menu)
 * @property {string} summary
 * @property {boolean} [hidden]     fora do menu (rota e busca continuam)
 * @property {string} [permission]  necessária para abrir
 * @property {ModuleSection[]} [sections]
 * @property {() => Promise<{ render: ModuleRender }>} load
 */

export const GROUPS = ['', 'Ferramentas'];

/** @type {ModuleDef[]} */
export const MODULES = [
  {
    id: 'dashboard',
    code: 'CMD',
    icon: 'home',
    name: 'Hoje',
    group: '',
    permission: 'dashboard.view',
    summary: 'O que precisa de você hoje: cobranças, sites fora do ar, vencimentos e tarefas.',
    load: () => import('./dashboard/index.js'),
  },
  {
    id: 'customers',
    code: 'CRM',
    icon: 'users',
    name: 'Clientes',
    group: '',
    permission: 'customers.view',
    summary: 'Clientes, contatos, projetos de cada um e o que pagam.',
    load: () => import('./customers/index.js'),
  },
  {
    id: 'projects',
    code: 'PRJ',
    icon: 'package',
    name: 'Projetos',
    group: '',
    permission: 'products.view',
    summary: 'Cada site ou sistema do começo ao fim: proposta, construção, publicado.',
    load: () => import('./projects/index.js'),
  },
  {
    id: 'infrastructure',
    code: 'SRV',
    icon: 'server',
    name: 'Serviços',
    group: '',
    permission: 'infra.view',
    summary: 'Serviços compartilhados e exclusivos: custo, preço, vencimento e monitoramento.',
    load: () => import('./infrastructure/index.js'),
  },
  {
    id: 'finance',
    code: 'FIN',
    icon: 'wallet',
    name: 'Dinheiro',
    group: '',
    permission: 'finance.view',
    summary: 'Mensalidades, custos, lucro por projeto e a conta da empresa no FinanceSolux.',
    load: () => import('./finance/index.js'),
  },
  {
    id: 'vault',
    code: 'VLT',
    icon: 'shield',
    name: 'Senhas',
    group: 'Ferramentas',
    permission: 'vault.view',
    load: () => import('./vault/index.js'),
    summary: 'Cofre de senhas e chaves da equipe, com criptografia no navegador.',
  },
  {
    id: 'workspace',
    code: 'WSP',
    icon: 'book',
    name: 'Documentos',
    group: 'Ferramentas',
    permission: 'workspace.view',
    load: () => import('./workspace/index.js'),
    summary: 'Documentos, notas e arquivos da equipe.',
  },
  {
    id: 'settings',
    code: 'ADM',
    icon: 'settings',
    name: 'Ajustes',
    group: 'Ferramentas',
    summary: 'Organização, equipe, tabela de preços, auditoria, integrações e sistema.',
    sections: [
      { id: 'organization', name: 'Organização', keywords: 'empresa nome' },
      { id: 'members', name: 'Equipe', permission: 'members.view', keywords: 'membros usuários convidar adicionar' },
      { id: 'prices', name: 'Tabela de preços', permission: 'products.view', keywords: 'preço item venda implantação manutenção kit' },
      { id: 'billing', name: 'Cobrança', keywords: 'pix whatsapp mensagem cobrar mensalidade' },
      { id: 'alerts', name: 'Avisos no celular', keywords: 'telegram celular alerta queda fora do ar avisos' },
      { id: 'checklist', name: 'Construção', keywords: 'checklist tarefas padrão construção' },
      { id: 'automations', name: 'Automações', permission: 'automations.view', keywords: 'rotinas lembretes avisos vencimentos' },
      { id: 'roles', name: 'Papéis e permissões', permission: 'roles.view', keywords: 'rbac acesso' },
      { id: 'audit', name: 'Atividade', permission: 'audit.view', keywords: 'auditoria log histórico registro' },
      { id: 'integrations', name: 'Integrações', permission: 'integrations.view', keywords: 'financesolux conectar' },
      { id: 'environment', name: 'Sistema', keywords: 'supabase ambiente configuração banco saúde' },
    ],
    load: () => import('./settings/index.js'),
  },
  {
    id: 'proposals',
    code: 'PRP',
    icon: 'fileText',
    name: 'Propostas',
    group: '',
    hidden: true,
    permission: 'proposals.view',
    load: () => import('./proposals/index.js'),
    summary: 'Propostas dos projetos: documento, envio e aceite.',
  },
  {
    id: 'analytics',
    code: 'ANL',
    icon: 'chart',
    name: 'Uso dos sites',
    group: '',
    hidden: true,
    permission: 'analytics.view',
    load: () => import('./analytics/index.js'),
    summary: 'Eventos de uso enviados pelos sites e sistemas (chave de coleta por projeto).',
  },
  {
    id: 'automation',
    code: 'AUT',
    icon: 'zap',
    name: 'Automações',
    group: '',
    hidden: true,
    permission: 'automations.view',
    load: () => import('./automation/index.js'),
    summary: 'Rotinas automáticas do servidor e o assistente DUM AI.',
  },
];

/** Rotas antigas que continuam abrindo a tela certa. */
const ALIASES = /** @type {Record<string, string>} */ ({ products: 'projects' });

/** @param {string} id */
export const findModule = (id) => MODULES.find((m) => m.id === (ALIASES[id] ?? id)) ?? null;
