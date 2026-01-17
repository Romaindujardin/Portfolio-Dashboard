declare module "react-simple-rotating-text" {
  import React from "react";

  interface RotatingTextProps {
    texts: string[];
    colors?: string[];
    backgroundColors?: string[];
    duration?: number;
    animation?: "fade" | "slide" | "scale";
    direction?: "horizontal" | "vertical";
    className?: string;
  }

  export const RotatingText: React.FC<RotatingTextProps>;
}
