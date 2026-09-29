/**
 * Test double for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The real package can only run inside the browser's loader module table: its
 * ESM entry imports a dozen CSS modules and pulls markdown/highlighting
 * dependencies that a plugin package does not install. This stub mirrors the
 * handful of exports the page uses — same prop names, same accessibility
 * surface — so the harness exercises the page's own behavior (state machine,
 * Host calls, menus, confirmation gating) without the browser toolchain.
 */
import { createElement as h, type ReactElement, type ReactNode } from 'react'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** Any icon export: a labelled placeholder that renders nothing visual. */
function icon(name: string) {
  return function Icon(props: IconProps): ReactElement {
    return h('span', { 'data-icon': name, 'aria-hidden': 'true', className: props.className })
  }
}

export const IconArchiveOutlineRegular = icon('archive')
export const IconChevronDownOutlineRegular = icon('chevron-down')
export const IconLoadingOutlineRegular = icon('loading')
export const IconSearchOutlineRegular = icon('search')
export const IconTrashOutlineRegular = icon('trash')
export const IconUnarchiveOutlineRegular = icon('unarchive')

interface ButtonProps {
  readonly variant?: string
  readonly size?: string
  readonly icon?: ReactNode
  readonly className?: string
  readonly children?: ReactNode
  readonly disabled?: boolean
  readonly onClick?: () => void
}

export function Button(props: ButtonProps): ReactElement {
  const { variant, size, icon: leading, className, children, ...rest } = props
  void variant
  void size
  return h(
    'button',
    { type: 'button', className, ...rest },
    leading == null ? null : h('span', null, leading),
    children,
  )
}

interface RiskConfirmationProps {
  readonly open: boolean
  readonly title: string
  readonly description?: ReactNode
  readonly acknowledgeLabel?: string
  readonly cancelLabel?: string
  readonly closeLabel?: string
  readonly confirmLabel?: string
  readonly acknowledged: boolean
  readonly disabled?: boolean
  readonly onAcknowledgedChange: (next: boolean) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Mirrors the real component's contract: confirm stays disabled until acknowledged. */
export function RiskConfirmation(props: RiskConfirmationProps): ReactElement | null {
  if (!props.open) return null
  return h(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
    h('h2', null, props.title),
    props.description == null ? null : h('p', null, props.description),
    h(
      'label',
      null,
      h('input', {
        type: 'checkbox',
        checked: props.acknowledged,
        disabled: props.disabled === true,
        onChange: (event: { currentTarget: { checked: boolean } }) => props.onAcknowledgedChange(event.currentTarget.checked),
      }),
      props.acknowledgeLabel ?? '',
    ),
    h('button', { type: 'button', onClick: props.onCancel }, props.cancelLabel ?? ''),
    h(
      'button',
      {
        type: 'button',
        disabled: props.disabled === true || !props.acknowledged,
        onClick: props.onConfirm,
      },
      props.confirmLabel ?? '',
    ),
  )
}
