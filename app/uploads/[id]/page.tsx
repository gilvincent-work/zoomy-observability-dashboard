import {notFound} from 'next/navigation';
import {getDataContext} from '@/src/active-context';
import {canEditData} from '@/src/company';
import {getExtraction, getUpload, signedUploadUrl} from '@/src/goldline-data';
import {UploadReview} from '@/components/analyst/upload-review';

export const dynamic = 'force-dynamic';

// Per-file review page. A scanned inventory PDF opens the review workbench (the
// staged Claude Vision extraction, editable before commit); a sales CSV has no
// extraction, so it shows a status summary. Scoped to the active company — a
// mismatched id (or another tenant's) resolves to notFound().
export default async function Page(props: {params: Promise<{id: string}>}) {
  const {id} = await props.params;
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Sign in to a company you belong to to review uploads.</p>
      </div>
    );
  }
  const upload = await getUpload(ctx.companyId, id);
  if (!upload) notFound();
  const [extraction, scanUrl] = await Promise.all([
    upload.kind === 'inventory_pdf' ? getExtraction(ctx.companyId, id) : Promise.resolve(null),
    upload.storage_path ? signedUploadUrl(ctx.companyId, id) : Promise.resolve(null),
  ]);
  return (
    <UploadReview
      company={ctx.companyId}
      canEdit={canEditData(ctx.role)}
      upload={upload}
      extraction={extraction}
      scanUrl={scanUrl}
    />
  );
}
