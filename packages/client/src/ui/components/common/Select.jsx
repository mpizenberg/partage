import { For, Show } from 'solid-js';
export const Select = (props) => {
    const classes = () => {
        const baseClass = 'select';
        const errorClass = props.error ? 'input-error' : '';
        const customClass = props.class || '';
        return `${baseClass} ${errorClass} ${customClass}`.trim();
    };
    return (<div class="select-wrapper">
      <select value={props.value || ''} disabled={props.disabled} required={props.required} class={classes()} onChange={props.onChange} id={props.id} name={props.name}>
        {props.placeholder && !props.children && (<option value="" disabled selected>
            {props.placeholder}
          </option>)}
        <Show when={props.children} fallback={<For each={props.options || []}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>}>
          {props.children}
        </Show>
      </select>
      <Show when={props.error}>
        <span class="input-error-text">{props.error}</span>
      </Show>
    </div>);
};
