// Affichage des réponses du Conseiller IA (markdown léger → composants stylés).
import React, { useMemo } from "react";
import { parseRichText, splitBoldSegments } from "../utils/richText";

const renderInline = (text: string) =>
  splitBoldSegments(text).map((segment, index) =>
    segment.bold ? (
      <strong key={index} className="font-semibold text-[#f5f5f5]">
        {segment.text}
      </strong>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );

const RichText: React.FC<{ text: string }> = ({ text }) => {
  const blocks = useMemo(() => parseRichText(text), [text]);

  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#c9c9c9]">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h4
                key={index}
                className={`font-semibold text-[#f5f5f5] ${
                  block.level <= 2 ? "text-base" : "text-sm"
                } ${index > 0 ? "pt-1" : ""}`}
              >
                {renderInline(block.text)}
              </h4>
            );
          case "bullets":
            return (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol key={index} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={index}>{renderInline(block.text)}</p>;
        }
      })}
    </div>
  );
};

export default RichText;
