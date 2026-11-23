// Orca's Badge, with a little room between its status dot and its text: Orca draws the dot too
// close, so a Badge with a dot (any tone but neutral) gets a non-breaking space in front of its
// text; a plain space would collapse at the start of the line. Use this instead of `Badge` from
// 'orca' everywhere in the plugin.
import { Badge as OrcaBadge, type BadgeProps, type OrcaNode } from 'orca'

const GAP = ' '

export function Badge(props: BadgeProps) {
  const { children, ...rest } = props
  const hasDot = props.tone !== undefined && props.tone !== 'neutral'
  const label: OrcaNode = hasDot && typeof children === 'string' ? `${GAP}${children}` : children
  return <OrcaBadge {...rest}>{label}</OrcaBadge>
}
