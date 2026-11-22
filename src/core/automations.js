// Catálogo das rotinas automáticas (as mesmas chaves da tabela automations, migration 0009).
// No Supabase rodam todo dia às 8h (Brasília) pelo pg_cron; "Rodar agora" executa na hora.

export const AUTOMATIONS = /** @type {const} */ ([
  {
    key: 'task_reminders',
    name: 'Lembrete de tarefas',
    description: 'Avisa cada pessoa das tarefas dela que vencem hoje ou já estão atrasadas.',
    audience: 'Quem faz a tarefa',
    permission: 'projects.view',
  },
  {
    key: 'renewal_alerts',
    name: 'Vencimentos da infraestrutura',
    description: 'Avisa 30, 7 e 1 dia antes (e no dia) de domínios, hospedagens e serviços vencerem.',
    audience: 'Quem gerencia a infraestrutura',
    permission: 'infra.view',
  },
  {
    key: 'billing_reminders',
    name: 'Cobranças do dia',
    description: 'De manhã, avisa quem vence hoje e quem está atrasado, com o total (e manda no Telegram, se ligado).',
    audience: 'Quem cuida das cobranças',
    permission: 'customers.view',
  },
  {
    key: 'proposal_followup',
    name: 'Propostas perto do fim da validade',
    description: 'Avisa quem montou a proposta enviada quando a validade termina hoje ou amanhã.',
    audience: 'Quem criou a proposta',
    permission: 'proposals.view',
  },
]);

/** @typedef {typeof AUTOMATIONS[number]['key']} AutomationKey */

/** @param {string} key */
export const automationName = (key) => AUTOMATIONS.find((a) => a.key === key)?.name ?? key;
