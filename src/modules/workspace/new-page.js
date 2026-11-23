// Criar página/reunião do Caderno (usado pelo Caderno, pelo projeto e pela ficha do cliente).

import { TEMPLATES, blocksToText } from '../../core/blocks.js';
import { normalizeProps } from '../../core/notebook.js';
import { today } from '../../core/validate.js';
import { formatDate } from '../../shared/utils/format.js';
import { data } from '../../services/data.js';

/**
 * @param {string} orgId
 * @param {{ templateId?: string, kind?: 'page' | 'meeting' | 'project', parentId?: string | null, productId?: string | null, customerId?: string | null, title?: string, position?: number, props?: Record<string, any> }} [options]
 * @returns {Promise<string>} id da página nova
 */
export async function newPage(orgId, { templateId = 'blank', kind, parentId = null, productId = null, customerId = null, title, position = Date.now() / 1000, props = {} } = {}) {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[TEMPLATES.length - 1];
  const finalKind = kind ?? template.kind;
  const meeting = finalKind === 'meeting';
  const content = template.blocks();
  const pageTitle = title ?? (meeting ? `Reunião de ${formatDate(today())}` : template.id === 'blank' ? '' : template.title);
  const { id } = await data.pages.create(orgId, {
    kind: finalKind,
    parentId,
    productId,
    customerId,
    position,
    title: pageTitle,
    icon: template.id === 'blank' ? '' : template.icon,
    iconColor: finalKind === 'project' ? 'blue' : finalKind === 'meeting' ? 'purple' : '',
    props: normalizeProps(finalKind, { docType: template.docType ?? undefined, ...props }),
    content,
    meeting: meeting ? { date: today(), durationS: 0, participants: [], transcript: [] } : null,
    searchText: `${pageTitle}\n${blocksToText(content)}`,
  });
  return id;
}
