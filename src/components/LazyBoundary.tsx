import { Component, Suspense, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import i18n from "@/lib/i18n";

// 遅延読込チャンク（React.lazy）の取得失敗でアプリ全体が白画面になるのを防ぐ境界。
// Web/PWA ではオフライン時やデプロイ直後（ハッシュ付きチャンクの404）に
// import() が失敗し得るため、Suspense と ErrorBoundary をセットで提供する。
// 失敗時は再読み込みボタンを表示する（リロードで新しい index.html → 新チャンクに復帰）。
// ※ ErrorBoundary はクラスコンポーネントでしか書けないため class を使用。

interface LazyBoundaryProps {
  children: ReactNode;
  /** 読込中の表示。未指定なら中央にローダー */
  fallback?: ReactNode;
}

interface LazyBoundaryState {
  failed: boolean;
}

const DefaultFallback = () => (
  <div className="flex items-center justify-center py-20">
    <DumbbellLoader className="w-6 h-6 text-accent" />
  </div>
);

class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  state: LazyBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[LazyBoundary] chunk/render error:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
          <p className="text-sm text-muted-foreground">{i18n.t("common.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            {i18n.t("common.reload")}
          </Button>
        </div>
      );
    }
    return (
      <Suspense fallback={this.props.fallback ?? <DefaultFallback />}>
        {this.props.children}
      </Suspense>
    );
  }
}

export default LazyBoundary;
