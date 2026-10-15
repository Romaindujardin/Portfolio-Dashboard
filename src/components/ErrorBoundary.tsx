import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 shadow-2xl text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-[#f5f5f5] mb-2">
              {this.props.fallbackTitle || "Une erreur est survenue lors de l'affichage"}
            </h2>
            <p className="text-sm text-[#8a8a8a] mb-4">
              Un problème inattendu s'est produit dans ce composant. Vos données locales sont intactes.
            </p>
            {this.state.error && (
              <div className="bg-[#0a0a0a] rounded-lg p-3 text-left font-mono text-xs text-red-300 border border-[rgba(255,255,255,0.05)] mb-5 overflow-auto max-h-36">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#c8a55e] to-[#dfc07e] text-[#0a0a0a] font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="h-4 w-4" />
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
