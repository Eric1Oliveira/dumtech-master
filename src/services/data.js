// Ponto ÚNICO de acesso a dados. Telas importam só daqui.
// O app fala só com o Supabase. O contrato abaixo também vale para o dublê dos testes
// (tests/support/fake-backend.js), que o smoke usa no lugar deste arquivo.

import { supabaseBackend } from './supabase.js';

/** @typedef {import('../core/state.js').User} User */
/** @typedef {import('../core/state.js').OrgSummary} OrgSummary */
/** @typedef {import('../core/permissions.js').RoleKey} RoleKey */

/**
 * @typedef {Object} SignInInput
 * @property {string} email
 * @property {string} [password]   obrigatório no Supabase
 * @property {string} [name]       usado ao criar conta / perfil local
 */

/**
 * @typedef {Object} Member
 * @property {string} userId
 * @property {string} name
 * @property {string} email
 * @property {RoleKey} role
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string | number} id
 * @property {string} actorLabel
 * @property {string} action     ex.: member.added, org.renamed
 * @property {string} entity
 * @property {string | null} entityId
 * @property {Record<string, any>} data
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AppNotification
 * @property {string} id
 * @property {string | null} orgId
 * @property {'info' | 'success' | 'warning' | 'danger'} kind
 * @property {string} title
 * @property {string} body
 * @property {string | null} link
 * @property {string | null} readAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Integration
 * @property {'financesolux'} provider
 * @property {'pending' | 'active' | 'error' | 'disabled'} status
 * @property {{ project_url?: string }} config
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Invitation
 * @property {string} id
 * @property {string} email
 * @property {RoleKey} role
 * @property {string} invitedBy   nome de quem convidou
 * @property {string} createdAt
 * @property {string} expiresAt
 */

/**
 * @typedef {Object} InvitePreview
 * @property {'valid' | 'invalid' | 'used' | 'revoked' | 'expired'} status
 * @property {string} [email]
 * @property {RoleKey} [role]
 * @property {string} [orgName]
 */

/**
 * @typedef {Object} CustomerInput
 * @property {'company' | 'person'} kind
 * @property {string} name
 * @property {string | null} document   só dígitos (CNPJ 14 / CPF 11)
 * @property {string | null} email
 * @property {string | null} phone
 * @property {string | null} city
 * @property {'lead' | 'active' | 'inactive'} status
 * @property {string | null} ownerId    responsável (membro da organização)
 * @property {string} notes
 * @property {string[]} tags            etiquetas (até 12)
 */

/**
 * @typedef {CustomerInput & { id: string, ownerName: string, createdAt: string, updatedAt: string }} Customer
 */

/** @typedef {import('../core/catalog.js').ProductInput} ProductInput */
/** @typedef {import('../core/proposals.js').ProposalInput} ProposalInput */
/** @typedef {import('../core/proposals.js').ProposalItem} ProposalItem */
/** @typedef {import('../core/proposals.js').ProposalStatus} ProposalStatus */
/** @typedef {import('../core/projects.js').TaskInput} TaskInput */

/** @typedef {import('../core/projects.js').Stage} Stage */
/** Projeto (tabela products). @typedef {ProductInput & { id: string, status: Stage, setupPaidOn: string | null, ownerName: string, createdAt: string, updatedAt: string }} Product */
/**
 * Novo projeto (RPC project_create, uma transação).
 * @typedef {Object} ProjectCreateInput
 * @property {'proposal' | 'closed' | 'live'} finish
 * @property {string} [since]   "já publicado": cobra desde
 * @property {{ id: string } | { new: { name: string, phone?: string, kind?: string } } | null} customer
 * @property {{ name: string, url?: string | null, kind?: string, description?: string }} project
 * @property {string[]} shared   compartilhados marcados
 * @property {Record<string, any>[]} exclusive   exclusivos novos (AssetInput parcial)
 * @property {{ monthly: number | null, setup: number | null, billingDay: number | null }} values
 * @property {import('../core/kit.js').KitLine[]} lines   linhas da proposta
 * @property {string} [proposalTitle]   título da proposta (padrão: o nome do projeto)
 */
/** @typedef {{ assetId: string, productId: string }} AssetLink */
/** @typedef {{ name: string, price: number, recurring: boolean, active: boolean, position: number }} SaleItemInput */
/** @typedef {SaleItemInput & { id: string }} SaleItem */
/**
 * O que o servidor vigia: o site do projeto, um banco ou um serviço. target = endereço resolvido.
 * @typedef {Object} Monitor
 * @property {string} id
 * @property {string | null} productId
 * @property {string | null} assetId
 * @property {'site' | 'database' | 'service'} kind
 * @property {string} label
 * @property {string | null} url
 * @property {string | null} target
 * @property {boolean} enabled
 * @property {number} slowMs
 * @property {'unknown' | 'up' | 'slow' | 'unstable' | 'down'} state
 * @property {string | null} lastCheckAt
 * @property {number | null} lastMs
 * @property {number | null} lastCode
 * @property {number} failStreak
 * @property {string | null} downSince
 * @property {number[]} checkDays     dias em que o servidor verifica (0 = domingo)
 * @property {string | null} checkFrom  início do horário ("08:00"); nulo = o dia todo
 * @property {string | null} checkTo
 * @property {number} checkEvery      de quanto em quanto tempo verifica (minutos)
 */
/** @typedef {{ monitorId: string, checkedAt: string, ok: boolean, code: number | null, msTotal: number | null, msConnect: number | null, cause: string | null, detail: string | null }} MonitorCheck */
/** @typedef {{ monitorId: string, hour: string, checks: number, ok: number, slow: number, msAvg: number | null, msP95: number | null, msMax: number | null }} MonitorHourly */
/** @typedef {{ id: string, monitorId: string, startedAt: string, endedAt: string | null, cause: string | null, code: number | null, failures: number }} MonitorIncident */
/** @typedef {import('../core/infra.js').AssetInput} AssetInput */
/** @typedef {AssetInput & { id: string, productName: string, ownerName: string, renewsCheckedAt: string | null, createdAt: string, updatedAt: string }} Asset */
/** @typedef {{ key: string, enabled: boolean, lastRunAt: string | null, lastResult: string | null }} AutomationState */
/** @typedef {import('../core/vault-crypto.js').VaultSettings} VaultSettings */
/** @typedef {import('../core/vault-crypto.js').Box} VaultBox */
/** Segredo do próprio cofre; sharedWith = nomes de quem recebeu uma cópia. @typedef {{ id: string, title: string, kind: 'login' | 'api_key' | 'note', updatedAt: string, sharedWith: string[] }} VaultItem */
/** Cópia recebida de outra pessoa (só leitura). @typedef {{ id: string, itemId: string, title: string, kind: 'login' | 'api_key' | 'note', updatedAt: string, ownerName: string }} VaultReceived */
/** Quem pode receber: membro com cofre. @typedef {{ userId: string, name: string, email: string, publicKey: string }} VaultMember */
/** Quem já recebe uma cópia do segredo. @typedef {{ shareId: string, recipientId: string, name: string, publicKey: string }} VaultShareTarget */
/** @typedef {import('../core/workspace.js').DocumentInput} DocumentInput */
/** @typedef {DocumentInput & { id: string, editorName: string, createdAt: string, updatedAt: string }} Doc */
/** @typedef {{ id: string, path: string, name: string, size: number, mime: string | null, productId: string | null, uploaderName: string, createdAt: string }} WorkspaceFile */
/** @typedef {{ id: string, productId: string, productName: string, label: string, prefix: string, createdAt: string, revokedAt: string | null }} AnalyticsKey */
/** @typedef {{ day: string, productId: string, events: number, clients: number }} AnalyticsDay */
/** @typedef {{ productId: string, event: string, total: number, clients: number, lastAt: string }} AnalyticsTop */
/**
 * @typedef {Object} FinanceSummary   conta da empresa no FinanceSolux (lida na hora, não copiada)
 * @property {string} account          nome da conta lida
 * @property {number} revenue          receita do mês atual (lançada + recorrentes previstas, como no FinanceSolux)
 * @property {number} expenses         despesa do mês atual (idem)
 * @property {number} projectedRevenue  parte da receita que é recorrente prevista
 * @property {number} projectedExpenses parte da despesa que é recorrente prevista
 * @property {number} net              resultado do mês (receita − despesa)
 * @property {number} balance          saldo em caixa hoje
 * @property {{ month: string, revenue: number, expenses: number, projectedRevenue: number, projectedExpenses: number }[]} months   últimos 6 meses, o atual primeiro
 * @property {string | null} lastTransactionOn
 * @property {string} fetchedAt
 */

/**
 * Dinheiro registrado no Master e a situação dele no FinanceSolux (função finance_items).
 * @typedef {Object} FinanceItem
 * @property {'payment' | 'setup' | 'entry'} source   mensalidade paga, implantação recebida ou avulso
 * @property {string} sourceId
 * @property {'revenue' | 'cost'} kind
 * @property {number} amount
 * @property {string} occurredOn
 * @property {string} description
 * @property {string} projectId
 * @property {'sending' | 'sent' | 'skipped' | null} status   null = falta lançar; sending = envio que não terminou
 * @property {string | null} remoteId
 * @property {string | null} linkedAt
 */
/** @typedef {{ description: string, amount: number, date: string }} FinanceMatch */
/**
 * O que falta lançar, conferido no FinanceSolux (Edge Function financesolux-push).
 * @typedef {Object} FinanceReview
 * @property {string} account
 * @property {string | null} adjustmentOn   último "ajuste de saldo" lá: antes dele, o dinheiro já está no saldo
 * @property {{ name: string, type: 'receita' | 'despesa' }[]} categories
 * @property {(FinanceItem & { category: string, matches: FinanceMatch[] })[]} items   category = sugestão para lá
 */

/**
 * @typedef {Object} CustomerProduct
 * @property {string} id
 * @property {string} customerId
 * @property {string} customerName
 * @property {string} productId
 * @property {string} productName
 * @property {'pending' | 'active' | 'cancelled'} status   pending = combinada, ainda não cobra
 * @property {string} since
 * @property {number | null} monthlyAmount   valor da mensalidade deste cliente
 * @property {number | null} billingDay      dia de vencimento (1–28)
 * @property {string | null} adjustedOn      último reajuste (o próximo é 1 ano depois dele ou do início)
 */

/** @typedef {import('../core/customers.js').ContactInput & { id: string, createdAt: string, updatedAt: string }} CustomerContact */
/** @typedef {import('../core/billing.js').PaymentInput & { id: string, createdAt: string }} Payment */
/** @typedef {import('../core/sites.js').EntryInput & { id: string, createdAt: string, updatedAt: string }} ProductEntry */
/** @typedef {import('../core/billing.js').SubscriptionTerms & { status?: 'pending' | 'active' | 'cancelled', adjustedOn?: string }} SubscriptionUpdate */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {number} number
 * @property {string} customerId
 * @property {string} customerName
 * @property {string} title
 * @property {ProposalStatus} status
 * @property {string | null} validUntil
 * @property {string} notes
 * @property {number} totalOnce
 * @property {number} totalMonthly
 * @property {string | null} sentAt
 * @property {string | null} decidedAt
 * @property {string | null} productId   o projeto da proposta
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @typedef {TaskInput & { id: string, assigneeName: string, projectName: string, pageTitle: string, doneAt: string | null, createdAt: string }} Task */
/**
 * Página do Caderno (sem o conteúdo; a lista é leve).
 * @typedef {Object} PageMeta
 * @property {string} id
 * @property {string | null} parentId
 * @property {'page' | 'meeting' | 'project'} kind
 * @property {string} title
 * @property {string} icon          nome do ícone de linha (icons.js); vazio = padrão do tipo
 * @property {string} iconColor     '', gray, blue, green, yellow, orange, red, purple, pink
 * @property {Record<string, any>} props   projeto: status, ownerId, startDate, dueDate · documento: docType
 * @property {string | null} productId
 * @property {string | null} customerId
 * @property {number} position
 * @property {string | null} archivedAt
 * @property {string | null} editingBy
 * @property {string | null} editingAt
 * @property {string} editingName
 * @property {string | null} meetingDate
 * @property {string} editorName
 * @property {string} createdAt
 * @property {string} updatedAt
 */
/**
 * Reunião: data, duração, quem participou e a transcrição (texto; o áudio nunca vai ao servidor).
 * @typedef {{ date: string, durationS: number, participants: string[], transcript: import('../core/minutes.js').Segment[] }} Meeting
 */
/** @typedef {PageMeta & { content: import('../core/blocks.js').Block[], meeting: Meeting | null }} Page */
/**
 * @typedef {Object} PageInput
 * @property {string | null} [parentId]
 * @property {'page' | 'meeting' | 'project'} [kind]
 * @property {string} [title]
 * @property {string} [icon]
 * @property {string} [iconColor]
 * @property {Record<string, any>} [props]
 * @property {import('../core/blocks.js').Block[]} [content]
 * @property {Meeting | null} [meeting]
 * @property {string} [searchText]
 * @property {string | null} [productId]
 * @property {string | null} [customerId]
 * @property {number} [position]
 */

/**
 * Operações padrão de uma tabela da organização.
 * @template T, I
 * @typedef {Object} OrgTable
 * @property {(orgId: string, filter?: Record<string, string>) => Promise<T[]>} list
 * @property {(orgId: string, input: I, id?: string) => Promise<string>} save   devolve o id
 * @property {(orgId: string, id: string) => Promise<void>} remove
 */

/**
 * @typedef {Object} Backend
 * @property {{
 *   getUser: () => Promise<User | null>,
 *   signIn: (input: SignInInput) => Promise<{ user: User | null }>,
 *   signUp: (input: SignInInput) => Promise<{ user: User | null, needsConfirmation?: boolean }>,
 *   signOut: () => Promise<void>,
 *   requestPasswordReset: (email: string) => Promise<void>,
 *   updatePassword: (password: string) => Promise<void>,
 *   updateName: (name: string) => Promise<void>,
 *   onChange: (handler: (event: string) => void) => () => void,
 * }} auth
 * @property {{
 *   listMine: () => Promise<OrgSummary[]>,
 *   create: (name: string) => Promise<{ id: string, name: string }>,
 *   rename: (orgId: string, name: string) => Promise<void>,
 *   auditViewers: (orgId: string) => Promise<string[]>,
 *   setAuditViewers: (orgId: string, roles: string[]) => Promise<string[]>,
 * }} orgs
 * @property {{
 *   list: (orgId: string) => Promise<Member[]>,
 *   setRole: (orgId: string, userId: string, role: RoleKey) => Promise<void>,
 *   remove: (orgId: string, userId: string) => Promise<void>,
 * }} members
 * @property {{
 *   list: (orgId: string) => Promise<Invitation[]>,
 *   create: (orgId: string, email: string, role: RoleKey) => Promise<{ token: string, expiresAt: string }>,
 *   revoke: (orgId: string, id: string) => Promise<void>,
 *   preview: (token: string) => Promise<InvitePreview>,
 *   accept: (token: string) => Promise<{ orgId: string, orgName: string }>,
 * }} invites
 * @property {{
 *   list: (orgId: string) => Promise<Customer[]>,
 *   save: (orgId: string, input: CustomerInput, id?: string) => Promise<void>,
 *   remove: (orgId: string, id: string) => Promise<void>,
 * }} customers
 * @property {OrgTable<CustomerContact, import('../core/customers.js').ContactInput>} customerContacts   pessoas de contato (customers.*)
 * @property {OrgTable<Product, ProductInput> & {
 *   create: (orgId: string, input: ProjectCreateInput) => Promise<string>,
 *   setStage: (orgId: string, id: string, stage: Stage, options?: { url?: string, since?: string, dueDate?: string, endServices?: boolean }) => Promise<void>,
 * }} products   projetos; a etapa só muda por setStage
 * @property {{
 *   list: (orgId: string) => Promise<AssetLink[]>,
 *   add: (orgId: string, assetId: string, productId: string) => Promise<void>,
 *   remove: (orgId: string, assetId: string, productId: string) => Promise<void>,
 * }} assetLinks   compartilhados marcados em cada projeto
 * @property {OrgTable<SaleItem, SaleItemInput>} saleItems   tabela de preços
 * @property {{
 *   get: (orgId: string, key: 'billing' | 'checklist') => Promise<any>,
 *   set: (orgId: string, key: 'billing' | 'checklist', value: any) => Promise<void>,
 * }} settings   ajustes da organização
 * @property {{
 *   list: (orgId: string) => Promise<Monitor[]>,
 *   save: (orgId: string, input: { productId?: string | null, assetId?: string | null, kind: string, label: string, url?: string | null, enabled: boolean }, id?: string) => Promise<string>,
 *   remove: (orgId: string, id: string) => Promise<void>,
 * }} monitors
 * @property {{
 *   list: (orgId: string, filter?: { productId?: string, customerId?: string }) => Promise<CustomerProduct[]>,
 *   link: (orgId: string, customerId: string, productId: string, terms?: import('../core/billing.js').SubscriptionTerms) => Promise<void>,
 *   update: (orgId: string, id: string, changes: SubscriptionUpdate) => Promise<void>,
 *   unlink: (orgId: string, id: string) => Promise<void>,
 * }} customerProducts   assinaturas: cliente × produto com valor e vencimento
 * @property {OrgTable<Payment, import('../core/billing.js').PaymentInput>} payments   mensalidades pagas (customers.*)
 * @property {OrgTable<ProductEntry, import('../core/sites.js').EntryInput>} productEntries   lançamentos avulsos do site (products.*)
 * @property {{
 *   list: (orgId: string) => Promise<Proposal[]>,
 *   items: (orgId: string, proposalId: string) => Promise<ProposalItem[]>,
 *   save: (orgId: string, input: ProposalInput, id?: string) => Promise<string>,
 *   setStatus: (orgId: string, id: string, status: ProposalStatus) => Promise<{ projectId: string | null }>,
 *   remove: (orgId: string, id: string) => Promise<void>,
 * }} proposals
 * @property {OrgTable<Task, TaskInput>} tasks
 * @property {OrgTable<Asset, AssetInput>} assets
 * @property {{
 *   checks: (orgId: string, monitorId?: string) => Promise<MonitorCheck[]>,
 *   history: (orgId: string, monitorIds: string[]) => Promise<{ checks: (MonitorCheck & { monitorId: string })[], hourly: MonitorHourly[], incidents: MonitorIncident[] }>,
 *   checkNow: (orgId: string) => Promise<number>,
 *   collect: (orgId: string) => Promise<number>,
 * }} monitoring       só o servidor verifica (Edge Function monitor); checkNow verifica na hora, collect não é mais preciso
 * @property {{
 *   list: (orgId: string) => Promise<AutomationState[]>,
 *   set: (orgId: string, key: string, enabled: boolean) => Promise<void>,
 *   run: (orgId: string, key: string) => Promise<string>,
 * }} automations
 * @property {{
 *   settings: (orgId: string) => Promise<VaultSettings | null>,
 *   setup: (orgId: string, settings: VaultSettings) => Promise<void>,
 *   setKeys: (orgId: string, keys: import('../core/vault-crypto.js').VaultKeys) => Promise<void>,
 *   list: (orgId: string) => Promise<VaultItem[]>,
 *   received: (orgId: string) => Promise<VaultReceived[]>,
 *   open: (orgId: string, id: string) => Promise<VaultBox>,
 *   openShared: (orgId: string, shareId: string) => Promise<import('../core/vault-crypto.js').SharedBox>,
 *   save: (orgId: string, item: { id: string, title: string, kind: string, box: VaultBox }) => Promise<void>,
 *   remove: (orgId: string, id: string) => Promise<void>,
 *   members: (orgId: string) => Promise<VaultMember[]>,
 *   sharesOf: (orgId: string, itemId: string) => Promise<VaultShareTarget[]>,
 *   share: (orgId: string, itemId: string, recipientId: string, box: import('../core/vault-crypto.js').SharedBox) => Promise<void>,
 *   unshare: (orgId: string, shareId: string) => Promise<void>,
 *   exportAll: (orgId: string) => Promise<(VaultBox & { id: string })[]>,
 *   rotate: (orgId: string, settings: VaultSettings, items: (VaultBox & { id: string })[]) => Promise<void>,
 * }} vault          cofre pessoal: o servidor só vê cifrados; abrir um segredo fica na auditoria
 * @property {{
 *   list: (orgId: string) => Promise<{ id: string, kind: 'weekly' | 'manual', size: number, createdAt: string }[]>,
 *   create: (orgId: string) => Promise<string>,
 *   get: (orgId: string, id: string) => Promise<any>,
 * }} backups       cópias de segurança no servidor (sem o cofre nem o token do Telegram)
 * @property {{
 *   status: (orgId: string) => Promise<{ configured: boolean, chat: string | null }>,
 *   set: (orgId: string, config: { token: string, chatId: string, chatName: string } | null) => Promise<void>,
 *   test: (orgId: string) => Promise<boolean>,
 * }} telegram      avisos no celular (o token fica só no servidor)
 * @property {OrgTable<Doc, DocumentInput>} documents   legado (virou páginas do Caderno)
 * @property {{
 *   list: (orgId: string) => Promise<PageMeta[]>,
 *   get: (orgId: string, id: string) => Promise<Page | null>,
 *   create: (orgId: string, input: PageInput) => Promise<{ id: string, updatedAt: string }>,
 *   save: (orgId: string, id: string, changes: PageInput, expectedUpdatedAt?: string | null) => Promise<{ updatedAt: string }>,
 *   archive: (orgId: string, id: string, archived: boolean) => Promise<void>,
 *   remove: (orgId: string, id: string) => Promise<void>,
 *   heartbeat: (orgId: string, id: string, on: boolean) => Promise<void>,
 *   versions: (orgId: string, pageId: string) => Promise<{ id: string, title: string, createdAt: string, authorName: string }[]>,
 *   version: (orgId: string, id: string) => Promise<{ title: string, content: import('../core/blocks.js').Block[] }>,
 *   search: (orgId: string, query: string) => Promise<{ id: string, title: string, icon: string, kind: 'page' | 'meeting' }[]>,
 * }} pages   Caderno (save com expectedUpdatedAt recusa por cima de outra pessoa: erro com code 'conflict')
 * @property {{
 *   list: (orgId: string) => Promise<WorkspaceFile[]>,
 *   upload: (orgId: string, file: File, productId?: string | null) => Promise<WorkspaceFile>,
 *   link: (orgId: string, file: WorkspaceFile) => Promise<string>,
 *   remove: (orgId: string, file: WorkspaceFile) => Promise<void>,
 * }} files          Supabase Storage (bucket privado)
 * @property {{
 *   keys: (orgId: string) => Promise<AnalyticsKey[]>,
 *   createKey: (orgId: string, productId: string, label: string) => Promise<{ id: string, key: string }>,
 *   revokeKey: (orgId: string, id: string) => Promise<void>,
 *   track: (key: string, event: string, props?: Record<string, any>, clientId?: string | null) => Promise<void>,
 *   daily: (orgId: string, days: number) => Promise<AnalyticsDay[]>,
 *   top: (orgId: string, days: number) => Promise<AnalyticsTop[]>,
 * }} analytics      track é o mesmo que os produtos chamam (só precisa da chave de coleta)
 * @property {{
 *   summary: (orgId: string) => Promise<FinanceSummary>,
 *   items: (orgId: string) => Promise<FinanceItem[]>,
 *   review: (orgId: string) => Promise<FinanceReview>,
 *   send: (orgId: string, item: { source: string, sourceId: string, category: string }) => Promise<void>,
 *   skip: (orgId: string, item: { source: string, sourceId: string }) => Promise<void>,
 *   clear: (orgId: string, item: { source: string, sourceId: string }) => Promise<void>,
 * }} finance   summary lê (financesolux-summary); review/send lançam (financesolux-push); o resto é RPC
 * @property {{ list: (orgId: string, options?: { limit?: number }) => Promise<AuditEntry[]> }} audit
 * @property {{
 *   list: () => Promise<AppNotification[]>,
 *   markRead: (id: string) => Promise<void>,
 *   markAllRead: () => Promise<void>,
 *   subscribe: (handler: () => void) => () => void,
 * }} notifications
 * @property {{
 *   get: (orgId: string, key: string) => Promise<any>,
 *   set: (orgId: string, key: string, value: any) => Promise<void>,
 * }} prefs
 * @property {{
 *   list: (orgId: string) => Promise<Integration[]>,
 *   saveConfig: (orgId: string, provider: 'financesolux', config: { project_url: string }) => Promise<void>,
 * }} integrations
 * @property {{ info: () => Promise<{ schemaVersion: string, scheduler: boolean, httpChecks: boolean, monitor?: boolean, storage: boolean }> }} health
 */

/** @type {Backend} */
/** O app usa só o Supabase; sem configuração, o boot mostra como ligar (src/core/app.js). */
export const data = supabaseBackend;
