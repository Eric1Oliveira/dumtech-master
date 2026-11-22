// Central de notificações: contador no sino + painel com a lista.
// As notificações são geradas pelo banco (ex.: alguém te adicionou a uma organização).

import { html, setHtml, createElement, $ } from '../utils/dom.js';
import { formatRelative } from '../utils/format.js';
import { data } from '../../services/data.js';
import { events } from '../../core/events.js';
import { getState } from '../../core/state.js';
import { switchOrganization, loadOrganizations } from '../../services/auth.js';
import { togglePopover, closePopover } from './popover.js';
import { emptyState, toastError, loadError } from './feedback.js';

/** @type {import('../../services/data.js').AppNotification[]} */
let items = [];
/** @type {HTMLElement | null} */
let panel = null;
let stopSubscription = () => {};

const unreadCount = () => items.filter((n) => !n.readAt).length;

export async function refreshNotifications() {
  try {
    items = await data.notifications.list();
  } catch (error) {
    console.warn('[notificações]', error);
    return;
  }
  updateBadge();
  if (panel) drawPanel();
}

export function startNotifications() {
  stopSubscription();
  stopSubscription = data.notifications.subscribe(async () => {
    await refreshNotifications();
    // Ser adicionado a uma organização chega como notificação: atualiza a lista de orgs.
    loadOrganizations().catch(() => {});
  });
  refreshNotifications();
}

export function stopNotifications() {
  stopSubscription();
  items = [];
}

export async function markAllNotificationsRead() {
  try {
    await data.notifications.markAllRead();
    await refreshNotifications();
  } catch (error) {
    toastError(error);
  }
}

/** @param {HTMLElement} anchor */
export function toggleNotificationCenter(anchor) {
  const element = createElement(html`<section class="notif" role="dialog" aria-label="Notificações"></section>`);
  panel = element;
  drawPanel();
  const close = togglePopover(anchor, element, { align: 'end', onClose: () => (panel = null) });
  if (!close) panel = null;
  else refreshNotifications();
}

function updateBadge() {
  const bell = $('#bell');
  if (!bell) return;
  const count = unreadCount();
  const badge = /** @type {HTMLElement} */ (bell.querySelector('.count-badge'));
  badge.hidden = count === 0;
  badge.textContent = count > 9 ? '9+' : String(count);
  const label = count ? `Notificações: ${count} não lida${count > 1 ? 's' : ''}` : 'Notificações';
  bell.setAttribute('aria-label', label);
  bell.title = label;
}

function drawPanel() {
  if (!panel) return;
  const count = unreadCount();
  setHtml(
    panel,
    html`
      <header class="notif__head">
        <h2 class="notif__title">Notificações</h2>
        <button type="button" class="btn btn--quiet btn--sm" data-read-all ${count ? '' : html`disabled`}>Marcar todas como lidas</button>
      </header>
      ${items.length
        ? html`<ul class="notif__list">${items.map(
            (n) => html`<li>
              <button type="button" class="notif__item ${n.readAt ? '' : 'is-unread'}" data-id="${n.id}">
                <span class="status-dot status-dot--${n.kind}" aria-hidden="true"></span>
                <span class="notif__body">
                  <span class="notif__item-title">${n.title}</span>
                  ${n.body ? html`<span class="notif__text">${n.body}</span>` : ''}
                  <time class="notif__time" datetime="${n.createdAt}">${formatRelative(n.createdAt)}</time>
                </span>
                ${n.readAt ? '' : html`<span class="sr-only">não lida</span>`}
              </button>
            </li>`,
          )}</ul>`
        : emptyState({ title: 'Nenhuma notificação', text: 'Avisos sobre sua conta e suas organizações aparecem aqui.', compact: true })}`,
  );
}

document.addEventListener('click', async (event) => {
  if (!panel) return;
  const target = /** @type {Element} */ (event.target);
  if (!panel.contains(target)) return;
  if (target.closest('[data-read-all]')) return markAllNotificationsRead();
  const item = /** @type {HTMLElement | null} */ (target.closest('[data-id]'));
  if (!item) return;
  const notification = items.find((n) => n.id === item.dataset.id);
  if (!notification) return;
  try {
    if (!notification.readAt) await data.notifications.markRead(notification.id);
    closePopover();
    if (notification.orgId && notification.orgId !== getState().org?.id) {
      await loadOrganizations();
      switchOrganization(notification.orgId);
    }
    if (notification.link?.startsWith('#/')) location.hash = notification.link;
    refreshNotifications();
  } catch (error) {
    if (panel) setHtml(panel, loadError(error));
    else toastError(error);
  }
});

events.on('notifications:changed', refreshNotifications);
