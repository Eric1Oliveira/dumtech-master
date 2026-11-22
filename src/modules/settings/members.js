// Membros da organização: busca, papel, convites e remoção (conforme o RBAC).
// Ninguém entra sem convite: o link prova que a pessoa recebeu o convite.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatDateTime, formatRelative, normalize } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { ROLES, roleName, checkMemberChange } from '../../core/permissions.js';
import { data } from '../../services/data.js';
import { canDo, loadOrganizations, inviteLink } from '../../services/auth.js';
import { dataTable } from '../../shared/components/table.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../services/data.js').Member} Member */
/** @typedef {import('../../services/data.js').Invitation} Invitation */
/** @typedef {import('../../core/permissions.js').RoleKey} RoleKey */

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org, user } = getState();
  const manage = canDo('members.manage');
  /** @type {Member[]} */
  let members = [];
  /** @type {Invitation[]} */
  let invites = [];
  let query = '';

  setHtml(
    root,
    html`<section class="panel">
      <header class="panel__head">
        <label class="search-field">
          ${icon('search')}<span class="sr-only">Buscar membro</span>
          <input class="input input--bare" type="search" placeholder="Buscar por nome ou e-mail" data-search>
        </label>
        ${manage ? html`<button type="button" class="btn btn--primary btn--sm" data-action="invite">${icon('userPlus')}<span>Convidar pessoa</span></button>` : ''}
      </header>
      <div id="members-table"><div class="skeleton"></div></div>
    </section>
    <section class="panel" id="invites" aria-labelledby="invites-title" hidden>
      <header class="panel__head">
        <h2 class="panel__title" id="invites-title">Convites pendentes</h2>
        <p class="panel__hint">O link vale 7 dias e funciona uma vez.</p>
      </header>
      <div id="invites-table"></div>
    </section>`,
  );
  const tableSlot = /** @type {HTMLElement} */ ($('#members-table', root));
  const invitesPanel = /** @type {HTMLElement} */ ($('#invites', root));
  const invitesSlot = /** @type {HTMLElement} */ ($('#invites-table', root));

  const ownerCount = () => members.filter((m) => m.role === 'owner').length;
  /** Papéis que esta pessoa pode atribuir a este membro (mesma regra do banco). */
  const allowedRoles = (/** @type {Member} */ m) =>
    ROLES.filter((r) => r.key === m.role || !checkMemberChange({ actorRole: org.role, current: m.role, next: r.key, ownerCount: ownerCount() }));
  /** Papéis que esta pessoa pode dar a quem ainda vai entrar. */
  const grantableRoles = () => ROLES.filter((r) => !checkMemberChange({ actorRole: org.role, current: null, next: r.key, ownerCount: ownerCount() }));

  const drawMembers = () => {
    const terms = normalize(query);
    const rows = members.filter((m) => normalize(`${m.name} ${m.email}`).includes(terms));
    tableSlot.replaceChildren(
      dataTable({
        label: 'Membros',
        rows,
        sort: { key: 'name', dir: 'asc' },
        empty: emptyState({ title: query ? 'Ninguém encontrado' : 'Nenhum membro', text: query ? `Nenhum membro corresponde a “${query}”.` : '', compact: true }),
        columns: [
          {
            key: 'name',
            label: 'Pessoa',
            sortValue: (m) => m.name || m.email,
            render: (m) => html`<span class="person"><strong>${m.name || '—'}${m.userId === user.id ? html` <span class="muted">(você)</span>` : ''}</strong><small>${m.email}</small></span>`,
          },
          {
            key: 'role',
            label: 'Papel',
            sortValue: (m) => -(ROLES.find((r) => r.key === m.role)?.rank ?? 0),
            render: (m) => {
              const options = manage ? allowedRoles(m) : [];
              if (options.length <= 1) return roleName(m.role);
              return html`<select class="input input--sm" data-role-for="${m.userId}" aria-label="Papel de ${m.name || m.email}">
                ${options.map((r) => html`<option value="${r.key}" ${r.key === m.role ? html`selected` : ''}>${r.name}</option>`)}
              </select>`;
            },
          },
          { key: 'since', label: 'Desde', hideOnMobile: true, sortValue: (m) => m.createdAt, render: (m) => html`<span class="mono">${formatDateTime(m.createdAt)}</span>` },
          {
            key: 'actions',
            label: 'Ações',
            align: 'end',
            render: (m) =>
              manage && !checkMemberChange({ actorRole: org.role, current: m.role, next: null, ownerCount: ownerCount() })
                ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove" data-user="${m.userId}" aria-label="Remover ${m.name || m.email}" title="Remover">${icon('trash')}</button>`
                : '',
          },
        ],
      }),
    );
  };

  const drawInvites = () => {
    invitesPanel.hidden = !invites.length;
    if (!invites.length) return invitesSlot.replaceChildren();
    const canTouch = (/** @type {Invitation} */ i) =>
      manage && !checkMemberChange({ actorRole: org.role, current: null, next: i.role, ownerCount: ownerCount() });
    invitesSlot.replaceChildren(
      dataTable({
        label: 'Convites pendentes',
        rows: invites,
        sort: { key: 'expires', dir: 'asc' },
        empty: emptyState({ title: 'Nenhum convite pendente', compact: true }),
        columns: [
          { key: 'email', label: 'E-mail', sortValue: (i) => i.email, render: (i) => html`<span class="person"><strong>${i.email}</strong><small>convidado por ${i.invitedBy || '—'}</small></span>` },
          { key: 'role', label: 'Papel', render: (i) => roleName(i.role) },
          {
            key: 'expires',
            label: 'Validade',
            hideOnMobile: true,
            sortValue: (i) => i.expiresAt,
            render: (i) =>
              new Date(i.expiresAt) < new Date()
                ? html`<span class="status-pill status-pill--danger">Expirado</span>`
                : html`<span class="mono" title="${formatDateTime(i.expiresAt)}">expira ${formatRelative(i.expiresAt)}</span>`,
          },
          {
            key: 'actions',
            label: 'Ações',
            align: 'end',
            render: (i) =>
              canTouch(i)
                ? html`<span class="row-actions">
                    <button type="button" class="btn btn--ghost btn--sm" data-action="renew" data-invite="${i.id}" title="Gera um link novo; o anterior deixa de valer">Novo link</button>
                    <button type="button" class="icon-btn icon-btn--sm" data-action="revoke" data-invite="${i.id}" aria-label="Cancelar convite de ${i.email}" title="Cancelar convite">${icon('x')}</button>
                  </span>`
                : '',
          },
        ],
      }),
    );
  };

  const load = async () => {
    try {
      [members, invites] = await Promise.all([data.members.list(org.id), data.invites.list(org.id)]);
      if (signal.aborted) return;
      drawMembers();
      drawInvites();
    } catch (error) {
      if (!signal.aborted) setHtml(tableSlot, loadError(error));
    }
  };

  /** Mudanças no próprio papel alteram o que a pessoa pode fazer: recarrega tudo. */
  const afterChange = async (/** @type {string} */ userId) => {
    if (userId === user.id) await loadOrganizations();
    await load();
  };

  /** Mostra o link uma única vez, com botão de copiar. */
  const showLink = async (/** @type {string} */ email, /** @type {{ token: string, expiresAt: string }} */ created) => {
    const link = inviteLink(created.token);
    await openDialog({
      title: 'Convite criado',
      description: `Envie este link para ${email} (WhatsApp, e-mail…). Ao abrir, a pessoa cria a senha e já entra na organização.`,
      body: html`<label class="field"><span class="field__label">Link do convite</span>
          <input class="input mono" name="link" value="${link}" readonly data-select-all></label>
        <p class="field__hint">Vale até ${formatDateTime(created.expiresAt)} e funciona uma vez. Por segurança, o link não aparece de novo: se perder, gere um novo.</p>`,
      submitLabel: 'Copiar link',
      cancelLabel: 'Fechar',
      onSubmit: async () => {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          throw new Error('Não foi possível copiar automaticamente. Selecione o link e use Ctrl+C.');
        }
        toast('Link copiado.', 'success');
      },
    });
  };

  /** @param {string} email @param {RoleKey} role */
  const createInvite = async (email, role) => {
    const created = await data.invites.create(org.id, email, role);
    await load();
    return created;
  };

  $('[data-search]', root).addEventListener('input', (event) => {
    query = /** @type {HTMLInputElement} */ (event.target).value;
    drawMembers();
  }, { signal });

  root.addEventListener('change', async (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const userId = select.dataset?.roleFor;
    if (!userId) return;
    const member = members.find((m) => m.userId === userId);
    const next = /** @type {RoleKey} */ (select.value);
    select.disabled = true;
    try {
      await data.members.setRole(org.id, userId, next);
      toast(`${member.name || member.email} agora é ${roleName(next)}.`, 'success');
      await afterChange(userId);
    } catch (error) {
      select.value = member.role;
      select.disabled = false;
      toastError(error);
    }
  }, { signal });

  // Campo do link: um clique seleciona tudo (cópia manual).
  document.addEventListener('focusin', (event) => {
    const field = /** @type {HTMLInputElement} */ (event.target);
    if (field.matches?.('[data-select-all]')) field.select();
  }, { signal });

  bindActions(
    root,
    {
      invite: async () => {
        /** @type {{ email: string, created: { token: string, expiresAt: string } } | null} */
        let result = null;
        await openDialog({
          title: 'Convidar pessoa',
          description: 'Você recebe um link para enviar à pessoa. Ela cria a própria senha e entra com o papel escolhido.',
          body: html`<label class="field"><span class="field__label">E-mail</span>
              <input class="input" type="email" name="email" required autocomplete="off"></label>
            <label class="field"><span class="field__label">Papel</span>
              <select class="input" name="role">
                ${grantableRoles().map((r) => html`<option value="${r.key}" ${r.key === 'member' ? html`selected` : ''}>${r.name} — ${r.summary}</option>`)}
              </select></label>`,
          submitLabel: 'Gerar link',
          onSubmit: async (form) => {
            const email = String(form.get('email')).trim().toLowerCase();
            result = { email, created: await createInvite(email, /** @type {RoleKey} */ (String(form.get('role')))) };
          },
        });
        if (result) await showLink(result.email, result.created);
      },
      renew: async (el) => {
        const inv = invites.find((i) => i.id === el.dataset.invite);
        try {
          await showLink(inv.email, await createInvite(inv.email, inv.role));
        } catch (error) {
          toastError(error);
        }
      },
      revoke: async (el) => {
        const inv = invites.find((i) => i.id === el.dataset.invite);
        const ok = await confirmDialog({
          title: 'Cancelar convite?',
          message: `O link enviado para ${inv.email} deixa de funcionar.`,
          confirmLabel: 'Cancelar convite',
          danger: true,
        });
        if (!ok) return;
        try {
          await data.invites.revoke(org.id, inv.id);
          toast('Convite cancelado.', 'success');
          load();
        } catch (error) {
          toastError(error);
        }
      },
      remove: async (el) => {
        const member = members.find((m) => m.userId === el.dataset.user);
        const self = member.userId === user.id;
        const ok = await confirmDialog({
          title: self ? 'Sair da organização?' : 'Remover membro?',
          message: self
            ? `Você perderá o acesso a ${org.name}.`
            : `${member.name || member.email} perderá o acesso a ${org.name}. A ação fica registrada na auditoria.`,
          confirmLabel: self ? 'Sair' : 'Remover',
          danger: true,
        });
        if (!ok) return;
        try {
          await data.members.remove(org.id, member.userId);
          toast(self ? 'Você saiu da organização.' : 'Membro removido.', 'success');
          if (self) {
            await loadOrganizations();
            location.hash = '#/dashboard';
          } else load();
        } catch (error) {
          toastError(error);
        }
      },
    },
    signal,
  );

  await load();
}
