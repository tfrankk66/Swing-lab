import { useRef, useState, type DragEvent } from "react";

interface Props {
  onPick: (file: File) => void;
}

/** First screen: choose a clip, plus the filming rules the measurements assume. */
export function Intake({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file?.type.startsWith("video/")) onPick(file);
  };

  return (
    <div className="intake">
      <div
        className={over ? "dropzone over" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <h1>Load a swing</h1>
        <p>Down-the-line, shot in your phone&rsquo;s slow-motion mode.</p>
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Choose video
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="shotlist">
        <h2>Camera setup</h2>
        <ol>
          <li>
            Stand the phone <b>behind the ball, on the target line</b>, lens at
            about hand height.
          </li>
          <li>
            <b>Slow motion, 240fps.</b> At 30fps the clubhead moves five feet
            between frames and impact never lands on one.
          </li>
          <li>
            Frame from <b>above your head to below the ball</b>, with a little
            room left and right.
          </li>
          <li>
            <b>Mark the spot.</b> Same distance and height every session, or
            trends across sessions measure the tripod, not the swing.
          </li>
        </ol>
      </div>
    </div>
  );
}
