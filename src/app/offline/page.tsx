import { LogoMark } from '@/components/Logo';
import en from '../../../messages/en.json';
import sw from '../../../messages/sw.json';

// Served by the service worker when a page isn't cached and there's no signal.
// Built once at deploy time, so it shows both languages rather than reading
// the locale cookie.
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto w-full flex flex-col items-center gap-4 px-6 pb-24 pt-24 text-center lg:max-w-md lg:px-8 lg:pb-16 lg:pt-10">
      <LogoMark size={56} />
      <h1 className="text-2xl font-extrabold">{en.offline.title}</h1>
      <p className="max-w-[32ch] text-soil">{en.offline.body}</p>
      <p lang="sw" className="max-w-[32ch] text-soil">
        <strong className="text-forest">{sw.offline.title}.</strong> {sw.offline.body}
      </p>
      <a href="/" className="btn-primary max-w-60">
        {en.offline.retry} · {sw.offline.retry}
      </a>
    </main>
  );
}
