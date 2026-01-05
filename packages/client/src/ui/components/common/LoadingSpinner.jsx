export const LoadingSpinner = (props) => {
    const size = () => props.size || 'medium';
    const sizeMap = {
        small: '20px',
        medium: '40px',
        large: '60px',
    };
    const spinnerSize = () => sizeMap[size()];
    return (<div class={`spinner ${props.class || ''}`} style={{ width: spinnerSize(), height: spinnerSize() }}>
      <div class="spinner-circle"></div>
    </div>);
};
