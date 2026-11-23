// Texto legível para cada ação registrada na auditoria.

import { roleName } from '../../core/permissions.js';
import { automationName } from '../../core/automations.js';

const PROVIDERS = { financesolux: 'FinanceSolux' };

/** Entidades com cadastro simples: <entidade>.created / .updated / .deleted */
const ENTITIES = {
  customer: 'o cliente',
  product: 'o projeto',
  project: 'o projeto (antigo)',
  sale_item: 'o item da tabela de preços',
  settings: 'os ajustes',
  task: 'a tarefa',
  proposal: 'a proposta',
  asset: 'o serviço',
  secret: 'o segredo',
  document: 'o documento',
  file: 'o arquivo',
  customer_contact: 'o contato',
  product_entry: 'o lançamento',
};

/** Nome legível das colunas que aparecem em "editou … (campos)". */
const FIELDS = {
  kind: 'tipo',
  name: 'nome',
  title: 'título',
  code: 'sigla',
  document: 'documento',
  email: 'e-mail',
  phone: 'telefone',
  city: 'cidade',
  status: 'situação',
  owner_id: 'responsável',
  assignee_id: 'quem faz',
  customer_id: 'cliente',
  notes: 'observações',
  description: 'descrição',
  version: 'versão',
  price: 'valor único',
  monthly_price: 'mensalidade',
  url: 'endereço',
  repository: 'repositório',
  start_date: 'início',
  due_date: 'prazo',
  provider: 'fornecedor',
  product_id: 'projeto',
  monitor: 'monitoramento',
  renews_at: 'vencimento',
  cost: 'custo',
  cost_period: 'período do custo',
  body: 'conteúdo',
  pinned: 'fixado',
  tags: 'etiquetas',
  role: 'cargo',
  is_primary: 'contato principal',
  amount: 'valor',
  occurred_on: 'data',
  paid_on: 'data do pagamento',
  setup_amount: 'implantação',
  setup_paid_on: 'implantação recebida em',
  setup_outside: 'implantação paga antes da empresa',
  note: 'observação',
};

/** @param {string[]} fields */
const fieldList = (fields = []) => fields.map((f) => FIELDS[f] ?? f).join(', ');

/**
 * @param {import('../../services/data.js').AuditEntry} entry
 * @returns {string} ex.: "adicionou ana@x.com como Gestor"
 */
export function describeAudit({ action, data = {} }) {
  switch (action) {
    case 'org.created':
      return `criou a organização “${data.name}”`;
    case 'org.renamed':
      return `renomeou a organização de “${data.from}” para “${data.to}”`;
    case 'member.joined':
      return `entrou na organização como ${roleName(data.role)}`;
    case 'member.added':
      return `adicionou ${data.email} como ${roleName(data.role)}`;
    case 'member.role_changed':
      return `mudou o papel de ${data.email}: ${roleName(data.from)} → ${roleName(data.to)}`;
    case 'member.removed':
      return `removeu ${data.email}`;
    case 'invite.created':
      return `convidou ${data.email} como ${roleName(data.role)}`;
    case 'invite.revoked':
      return `cancelou o convite de ${data.email}`;
    case 'proposal.sent':
      return `marcou a proposta “${data.name}” como enviada`;
    case 'proposal.accepted':
      return `registrou o aceite da proposta “${data.name}”`;
    case 'proposal.rejected':
      return `registrou a recusa da proposta “${data.name}”`;
    case 'proposal.reopened':
      return `voltou a proposta “${data.name}” para rascunho`;
    case 'product.customer_added':
      return `incluiu ${data.customer} no projeto “${data.name}”`;
    case 'product.customer_removed':
      return `tirou ${data.customer} do projeto “${data.name}”`;
    case 'project.stage':
      return `levou o projeto “${data.name}” para ${({ proposal: 'Proposta', building: 'Em construção', live: 'Publicado', ended: 'Encerrado' })[data.to] ?? data.to}`;
    case 'settings.updated':
      if (data.name === 'audit_viewers') return `mudou quem vê a atividade: só o proprietário${data.roles?.length ? ` e ${data.roles.map((/** @type {string} */ r) => roleName(r)).join(', ')}` : ''}`;
      return `mudou os ajustes de ${data.name === 'checklist' ? 'construção (checklist)' : data.name === 'telegram' ? 'avisos no celular' : 'cobrança'}`;
    case 'vault.created':
      return 'criou o próprio cofre de senhas';
    case 'vault.rotated':
      return `trocou a frase-mestra do cofre (${data.items} segredo(s) recifrado(s))`;
    case 'vault.exported':
      return 'leu os cifrados do cofre para trocar a frase-mestra';
    case 'secret.revealed':
      return data.shared ? `abriu a senha compartilhada “${data.name}”` : `abriu o segredo “${data.name}”`;
    case 'secret.shared':
      return `compartilhou “${data.name}” com ${data.recipient}`;
    case 'secret.unshared':
      return `parou o compartilhamento de “${data.name}” com ${data.recipient}`;
    case 'file.created':
      return `enviou o arquivo “${data.name}”`;
    case 'analytics_key.created':
      return `criou a chave de coleta “${data.name}” (${data.product})`;
    case 'analytics_key.revoked':
      return `revogou a chave de coleta “${data.name}”`;
    case 'automation.enabled':
      return `ligou a automação “${automationName(data.key)}”`;
    case 'automation.disabled':
      return `desligou a automação “${automationName(data.key)}”`;
    case 'automation.ran':
      return `rodou a automação “${automationName(data.key)}” (${data.result})`;
    case 'integration.created':
    case 'integration.updated':
      return `configurou a integração ${PROVIDERS[data.provider] ?? data.provider}`;
    case 'billing_payment.created':
      return `registrou o pagamento da mensalidade de ${data.name}`;
    case 'billing_payment.updated':
      return `corrigiu o pagamento da mensalidade de ${data.name}`;
    case 'billing_payment.deleted':
      return `desfez o pagamento da mensalidade de ${data.name}`;
    case 'finance_link.sent':
      return `criou “${data.name}” no FinanceSolux`;
    case 'finance_link.skipped':
      return `marcou “${data.name}” como já lançado no FinanceSolux`;
    case 'finance_link.cleared':
      return `voltou “${data.name}” para a lista do FinanceSolux`;
  }
  const [entity, verb] = action.split('.');
  const noun = ENTITIES[entity];
  if (noun && verb === 'created') return `cadastrou ${noun} “${data.name}”`;
  if (noun && verb === 'updated') return `editou ${noun} “${data.name}”${data.fields?.length ? ` (${fieldList(data.fields)})` : ''}`;
  if (noun && verb === 'deleted') return `excluiu ${noun} “${data.name}”`;
  return action;
}

/** Grupos para o filtro da auditoria (prefixo da ação). */
export const AUDIT_GROUPS = [
  { id: 'org', label: 'Organização' },
  { id: 'member', label: 'Membros' },
  { id: 'invite', label: 'Convites' },
  { id: 'customer', label: 'Clientes' },
  { id: 'billing_payment', label: 'Cobranças' },
  { id: 'product', label: 'Projetos' },
  { id: 'proposal', label: 'Propostas' },
  { id: 'sale_item', label: 'Tabela de preços' },
  { id: 'task', label: 'Tarefas' },
  { id: 'asset', label: 'Serviços' },
  { id: 'automation', label: 'Automações' },
  { id: 'secret', label: 'Cofre (segredos)' },
  { id: 'vault', label: 'Cofre (configuração)' },
  { id: 'document', label: 'Documentos' },
  { id: 'file', label: 'Arquivos' },
  { id: 'analytics_key', label: 'Analytics' },
  { id: 'integration', label: 'Integrações' },
  { id: 'finance_link', label: 'FinanceSolux' },
];
