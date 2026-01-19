import { Component, JSX } from 'solid-js';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  class?: string;
  children: JSX.Element;
}

export const Button: Component<ButtonProps> = (props) => {
  const variant = () => props.variant || 'primary';
  const size = () => props.size || 'medium';

  const classes = () => {
    const baseClasses = 'btn';
    const variantClass = `btn-${variant()}`;
    const sizeClass = `btn-${size()}`;
    const customClass = props.class || '';
    return `${baseClasses} ${variantClass} ${sizeClass} ${customClass}`.trim();
  };

  return (
    <button
      type={props.type || 'button'}
      class={classes()}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
};
