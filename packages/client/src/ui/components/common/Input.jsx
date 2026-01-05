export const Input = (props) => {
    const classes = () => {
        const baseClass = 'input';
        const errorClass = props.error ? 'error' : '';
        const customClass = props.class || '';
        return `${baseClass} ${errorClass} ${customClass}`.trim();
    };
    return (<input type={props.type || 'text'} value={props.value || ''} placeholder={props.placeholder} disabled={props.disabled} required={props.required} class={classes()} onInput={props.onInput} onChange={props.onChange} onBlur={props.onBlur} onKeyPress={props.onKeyPress} id={props.id} name={props.name} min={props.min} max={props.max} step={props.step}/>);
};
