import { Component, JSX, For } from 'solid-js'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value?: string
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
  class?: string
  onChange?: JSX.EventHandler<HTMLSelectElement, Event>
  id?: string
  name?: string
}

export const Select: Component<SelectProps> = (props) => {
  const classes = () => {
    const baseClass = 'select'
    const customClass = props.class || ''
    return `${baseClass} ${customClass}`.trim()
  }

  return (
    <select
      value={props.value || ''}
      disabled={props.disabled}
      required={props.required}
      class={classes()}
      onChange={props.onChange}
      id={props.id}
      name={props.name}
    >
      {props.placeholder && (
        <option value="" disabled selected>
          {props.placeholder}
        </option>
      )}
      <For each={props.options}>
        {(option) => <option value={option.value}>{option.label}</option>}
      </For>
    </select>
  )
}
