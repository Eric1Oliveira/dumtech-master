// RBAC — catálogo de papéis e permissões.
// Espelho das migrations em supabase/migrations/ (tests/db.test.js confere).
// No modo Supabase quem decide de verdade é o banco (RLS + funções). Aqui o catálogo
// serve para a interface esconder o que o papel não pode fazer.

/** @typedef {'owner' | 'admin' | 'manager' | 'member' | 'viewer'} RoleKey */

/** @type {{ key: RoleKey, name: string, rank: number, summary: string }[]} */
export const ROLES = [
  { key: 'owner', name: 'Proprietário', rank: 100, summary: 'Controle total, inclusive sobre outros proprietários.' },
  { key: 'admin', name: 'Administrador', rank: 80, summary: 'Gerencia membros, integrações e dados da organização.' },
  { key: 'manager', name: 'Gestor', rank: 60, summary: 'Conduz a operação e lê a auditoria.' },
  { key: 'member', name: 'Membro', rank: 40, summary: 'Trabalha nos módulos (clientes, propostas, projetos) e vê a equipe.' },
  { key: 'viewer', name: 'Leitor', rank: 20, summary: 'Somente leitura dos módulos de operação.' },
];

/** @type {{ key: string, description: string }[]} */
export const PERMISSIONS = [
  { key: 'dashboard.view', description: 'Ver o Command Center' },
  { key: 'org.update', description: 'Editar os dados da organização' },
  { key: 'members.view', description: 'Ver os membros' },
  { key: 'members.manage', description: 'Convidar, remover e mudar o papel de membros' },
  { key: 'roles.view', description: 'Ver papéis e permissões' },
  { key: 'audit.view', description: 'Ver a trilha de auditoria' },
  { key: 'integrations.view', description: 'Ver integrações' },
  { key: 'integrations.manage', description: 'Configurar integrações' },
  { key: 'customers.view', description: 'Ver clientes' },
  { key: 'customers.manage', description: 'Cadastrar, editar e excluir clientes' },
  { key: 'products.view', description: 'Ver produtos e sistemas' },
  { key: 'products.manage', description: 'Cadastrar e editar produtos e sistemas' },
  { key: 'proposals.view', description: 'Ver propostas' },
  { key: 'proposals.manage', description: 'Montar, enviar e decidir propostas' },
  { key: 'projects.view', description: 'Ver projetos e tarefas' },
  { key: 'projects.manage', description: 'Criar e editar projetos e tarefas' },
  { key: 'infra.view', description: 'Ver a infraestrutura' },
  { key: 'infra.manage', description: 'Cadastrar serviços e monitoramento' },
  { key: 'automations.view', description: 'Ver as automações' },
  { key: 'automations.manage', description: 'Ligar, desligar e rodar automações' },
  { key: 'vault.view', description: 'Ter o próprio cofre de senhas' },
  { key: 'workspace.view', description: 'Ver documentos e arquivos' },
  { key: 'workspace.manage', description: 'Criar, editar e excluir documentos e arquivos' },
  { key: 'analytics.view', description: 'Ver o uso dos produtos' },
  { key: 'analytics.manage', description: 'Criar e revogar chaves de coleta' },
  { key: 'finance.view', description: 'Ver os números financeiros (FinanceSolux)' },
];

const ALL = PERMISSIONS.map((p) => p.key);

/** @type {Record<RoleKey, string[]>} */
export const ROLE_PERMISSIONS = {
  owner: ALL,
  admin: ALL,
  manager: [
    'dashboard.view', 'members.view', 'roles.view', 'audit.view', 'integrations.view',
    'customers.view', 'customers.manage', 'products.view', 'products.manage',
    'proposals.view', 'proposals.manage', 'projects.view', 'projects.manage',
    'infra.view', 'infra.manage', 'automations.view', 'vault.view', 'workspace.view', 'workspace.manage',
    'analytics.view', 'finance.view',
  ],
  member: [
    'dashboard.view', 'members.view', 'roles.view', 'customers.view', 'customers.manage',
    'products.view', 'proposals.view', 'proposals.manage', 'projects.view', 'projects.manage', 'infra.view',
    'workspace.view', 'workspace.manage', 'analytics.view', 'vault.view',
  ],
  viewer: ['dashboard.view', 'customers.view', 'products.view', 'proposals.view', 'projects.view', 'workspace.view'],
};

/**
 * O papel tem a permissão?
 * @param {RoleKey | null | undefined} role
 * @param {string} permission
 */
export const can = (role, permission) => Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));

/** @param {string} key */
export const roleName = (key) => ROLES.find((r) => r.key === key)?.name ?? key;

/** @param {string} key */
export const isRole = (key) => ROLES.some((r) => r.key === key);

/**
 * Regra única para adicionar (current = null), mudar papel e remover (next = null).
 * Mesmas regras de public.assert_member_change no banco.
 * @param {{ actorRole: RoleKey | null, current: RoleKey | null, next: RoleKey | null, ownerCount: number }} change
 * @returns {string | null} mensagem de erro, ou null se permitido
 */
export function checkMemberChange({ actorRole, current, next, ownerCount }) {
  if (!can(actorRole, 'members.manage')) return 'Seu papel não permite gerenciar membros.';
  if (next !== null && !isRole(next)) return 'Papel inválido.';
  if ((current === 'owner' || next === 'owner') && actorRole !== 'owner') {
    return 'Somente um proprietário pode conceder ou retirar o papel de proprietário.';
  }
  if (current === 'owner' && next !== 'owner' && ownerCount <= 1) {
    return 'A organização precisa de pelo menos um proprietário.';
  }
  return null;
}
