// Caps content width on very wide screens and centers it.
export default function PageContainer({ className = '', children }) {
  return <div className={`mx-auto w-full max-w-7xl ${className}`}>{children}</div>;
}
