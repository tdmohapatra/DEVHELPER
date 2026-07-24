export function NativeNotice({ what }: { what: string }) {
  return (
    <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      {what} needs the <b>DevHelper desktop app</b> (native OS access). It is disabled in browser dev mode.
    </div>
  );
}
