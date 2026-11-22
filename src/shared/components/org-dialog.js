// Diálogo "Nova organização" (sidebar, busca e Administração usam o mesmo).

import { html } from '../utils/dom.js';
import { openDialog } from './dialog.js';
import { toast } from './feedback.js';
import { createOrganization } from '../../services/auth.js';
import { navigate } from '../../core/router.js';

export async function promptNewOrganization() {
  let name = '';
  const created = await openDialog({
    title: 'Nova organização',
    description: 'Cada organização tem membros, papéis e dados próprios. Você será o proprietário.',
    body: html`<label class="field">
        <span class="field__label">Nome</span>
        <input class="input" name="name" required minlength="2" maxlength="80" autocomplete="organization">
      </label>`,
    submitLabel: 'Criar organização',
    onSubmit: async (form) => {
      name = String(form.get('name') ?? '').trim();
      await createOrganization(name);
    },
  });
  if (created) {
    toast(`Organização “${name}” criada.`, 'success');
    navigate('/dashboard');
  }
}
