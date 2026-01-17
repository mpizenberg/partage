import { Component, JSX } from 'solid-js'

export interface InputProps {
  type?: 'text' | 'number' | 'date' | 'email' | 'password'
  value?: string | number
  placeholder?: string
  disabled?: boolean
  required?: boolean
  class?: string
  error?: boolean
  onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>
  onChange?: JSX.EventHandler<HTMLInputElement, Event>
  onBlur?: JSX.EventHandler<HTMLInputElement, FocusEvent>
  onKeyPress?: JSX.EventHandler<HTMLInputElement, KeyboardEvent>
  id?: string
  name?: string
  min?: number
  max?: number
  step?: number
  autocomplete?: string
}

export const Input: Component<InputProps> = (props) => {
  const classes = () => {
    const baseClass = 'input'
    const errorClass = props.error ? 'error' : ''
    const customClass = props.class || ''
    return `${baseClass} ${errorClass} ${customClass}`.trim()
  }

  return (
    <input
      type={props.type || 'text'}
      value={props.value || ''}
      placeholder={props.placeholder}
      disabled={props.disabled}
      required={props.required}
      class={classes()}
      onInput={props.onInput}
      onChange={props.onChange}
      onBlur={props.onBlur}
      onKeyPress={props.onKeyPress}
      id={props.id}
      name={props.name}
      min={props.min}
      max={props.max}
      step={props.step}
      autocomplete={props.autocomplete}
    />
  )
}
