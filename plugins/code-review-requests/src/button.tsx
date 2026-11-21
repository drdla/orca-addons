// Orca's Button, with a little room between its icon and its text: Orca draws them too close,
// so a button with an icon gets a non-breaking space in front of a text label. Use this instead
// of `Button` from 'orca' everywhere in the plugin.
import { Button as OrcaButton, type ButtonProps, type OrcaNode } from 'orca'

const GAP = ' '

export function Button(props: ButtonProps) {
  const { children, ...rest } = props
  const label: OrcaNode = props.icon !== undefined && typeof children === 'string' ? `${GAP}${children}` : children
  return <OrcaButton {...rest}>{label}</OrcaButton>
}
