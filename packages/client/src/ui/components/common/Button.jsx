export const Button = (props) => {
    const variant = () => props.variant || 'primary';
    const size = () => props.size || 'medium';
    const classes = () => {
        const baseClasses = 'btn';
        const variantClass = `btn-${variant()}`;
        const sizeClass = `btn-${size()}`;
        const customClass = props.class || '';
        return `${baseClasses} ${variantClass} ${sizeClass} ${customClass}`.trim();
    };
    return (<button type={props.type || 'button'} class={classes()} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>);
};
