'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, FileDown, Loader2, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createDefaultOfficialDocumentMetadataForm,
  validateOfficialDocumentMetadata,
  type OfficialDocumentMetadataForm,
  type OfficialDocumentValidationResult,
} from '@/lib/official-document';

type OfficialDocumentExportDialogProps = {
  filename: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  validation: OfficialDocumentValidationResult | null;
};

type FieldErrors = Partial<
  Record<keyof OfficialDocumentMetadataForm, string>
>;

export function OfficialDocumentExportDialog({
  filename,
  onOpenChange,
  open,
  validation,
}: OfficialDocumentExportDialogProps) {
  const [metadata, setMetadata] = useState(
    createDefaultOfficialDocumentMetadataForm
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [exportError, setExportError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const document = validation?.document ?? null;
  const headingCount =
    document?.blocks.filter((block) => block.kind === 'heading').length ?? 0;
  const paragraphCount =
    document?.blocks.filter((block) => block.kind === 'paragraph').length ?? 0;

  function updateMetadata<K extends keyof OfficialDocumentMetadataForm>(
    field: K,
    value: OfficialDocumentMetadataForm[K]
  ) {
    setMetadata((current) => {
      const next = { ...current, [field]: value };

      if (field === 'issuingAuthority') {
        if (current.signingAuthority === current.issuingAuthority) {
          next.signingAuthority = value;
        }
        if (current.printingAuthority === current.issuingAuthority) {
          next.printingAuthority = value;
        }
      }

      if (field === 'documentDate' && current.printingDate === current.documentDate) {
        next.printingDate = value;
      }

      return next;
    });
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setExportError('');
  }

  async function handleExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!document) {
      return;
    }

    const metadataValidation = validateOfficialDocumentMetadata(metadata);

    if (!metadataValidation.valid) {
      setFieldErrors(
        Object.fromEntries(
          metadataValidation.errors.map((error) => [error.field, error.message])
        )
      );
      return;
    }

    setIsExporting(true);
    setExportError('');

    try {
      const {
        createOfficialDocumentDocx,
        downloadOfficialDocumentDocx,
      } = await import('@/lib/official-document-docx');
      const blob = await createOfficialDocumentDocx(
        document,
        metadataValidation.data
      );
      downloadOfficialDocumentDocx(
        blob,
        !filename || filename === '未命名文档' ? document.title : filename
      );
      onOpenChange(false);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : '红头文件生成失败，请稍后重试。'
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>导出红头文件</DialogTitle>
          <DialogDescription>
            先校验编辑器正文，再将 H1、H2、段落和下方元数据合成为规范 DOCX。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleExport}
        >
          <DialogBody className="mt-5 overflow-y-auto">
            {!validation || !validation.valid || !document ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <TriangleAlert aria-hidden="true" />
                  正文格式校验未通过
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  红头文件正文只接受一个 H1 主标题，以及 H2 一级章节和普通段落。
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {validation?.errors.map((error, index) => (
                    <li key={`${error.code}-${error.blockIndex ?? index}`}>
                      {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 aria-hidden="true" />
                    正文格式校验通过
                  </div>
                  <p className="mt-2 text-sm font-medium">{document.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    已提取 {headingCount} 个一级章节、{paragraphCount} 个正文段落。
                  </p>
                  {validation.warnings.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {validation.warnings.map((warning, index) => (
                        <li
                          key={`${warning.code}-${warning.blockIndex ?? index}`}
                        >
                          {warning.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <section aria-labelledby="official-header-fields">
                  <h3
                    id="official-header-fields"
                    className="mb-3 text-sm font-semibold"
                  >
                    版头信息
                  </h3>
                  <FieldGroup className="sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="official-issuing-authority">
                        发文机关
                      </FieldLabel>
                      <Input
                        id="official-issuing-authority"
                        value={metadata.issuingAuthority}
                        aria-invalid={Boolean(fieldErrors.issuingAuthority)}
                        onChange={(event) =>
                          updateMetadata('issuingAuthority', event.target.value)
                        }
                      />
                      <FieldError>{fieldErrors.issuingAuthority}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-copy-number">份号</FieldLabel>
                      <Input
                        id="official-copy-number"
                        inputMode="numeric"
                        maxLength={6}
                        value={metadata.copyNumber}
                        aria-invalid={Boolean(fieldErrors.copyNumber)}
                        onChange={(event) =>
                          updateMetadata('copyNumber', event.target.value)
                        }
                      />
                      <FieldDescription>可选；填写时必须为 6 位数字。</FieldDescription>
                      <FieldError>{fieldErrors.copyNumber}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-security-level">
                        密级和保密期限
                      </FieldLabel>
                      <Input
                        id="official-security-level"
                        placeholder="例如：秘密★10年"
                        value={metadata.securityLevel}
                        onChange={(event) =>
                          updateMetadata('securityLevel', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-urgency">
                        紧急程度
                      </FieldLabel>
                      <Input
                        id="official-urgency"
                        placeholder="例如：特急"
                        value={metadata.urgency}
                        onChange={(event) =>
                          updateMetadata('urgency', event.target.value)
                        }
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="official-document-number">
                        发文字号
                      </FieldLabel>
                      <Input
                        id="official-document-number"
                        placeholder="例如：泉农〔2026〕12号；留空则生成截图中的简化版头"
                        value={metadata.documentNumber}
                        onChange={(event) =>
                          updateMetadata('documentNumber', event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>
                </section>

                <section aria-labelledby="official-body-fields">
                  <h3
                    id="official-body-fields"
                    className="mb-3 text-sm font-semibold"
                  >
                    正文前后信息
                  </h3>
                  <FieldGroup className="sm:grid-cols-2">
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="official-primary-recipient">
                        主送机关
                      </FieldLabel>
                      <Textarea
                        id="official-primary-recipient"
                        rows={2}
                        value={metadata.primaryRecipient}
                        onChange={(event) =>
                          updateMetadata('primaryRecipient', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-signing-authority">
                        发文机关署名
                      </FieldLabel>
                      <Input
                        id="official-signing-authority"
                        placeholder="留空时使用发文机关"
                        value={metadata.signingAuthority}
                        onChange={(event) =>
                          updateMetadata('signingAuthority', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-document-date">
                        成文日期
                      </FieldLabel>
                      <Input
                        id="official-document-date"
                        type="date"
                        value={metadata.documentDate}
                        aria-invalid={Boolean(fieldErrors.documentDate)}
                        onChange={(event) =>
                          updateMetadata('documentDate', event.target.value)
                        }
                      />
                      <FieldError>{fieldErrors.documentDate}</FieldError>
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="official-note">附注</FieldLabel>
                      <Textarea
                        id="official-note"
                        rows={2}
                        placeholder="可选；无需手工输入外层括号"
                        value={metadata.note}
                        onChange={(event) =>
                          updateMetadata('note', event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>
                </section>

                <section aria-labelledby="official-record-fields">
                  <h3
                    id="official-record-fields"
                    className="mb-3 text-sm font-semibold"
                  >
                    版记信息
                  </h3>
                  <FieldGroup className="sm:grid-cols-2">
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="official-cc-recipients">
                        抄送机关
                      </FieldLabel>
                      <Textarea
                        id="official-cc-recipients"
                        rows={2}
                        placeholder="可选；无需手工输入“抄送：”和句号"
                        value={metadata.ccRecipients}
                        onChange={(event) =>
                          updateMetadata('ccRecipients', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-printing-authority">
                        印发机关
                      </FieldLabel>
                      <Input
                        id="official-printing-authority"
                        placeholder="留空时使用发文机关"
                        value={metadata.printingAuthority}
                        onChange={(event) =>
                          updateMetadata('printingAuthority', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="official-printing-date">
                        印发日期
                      </FieldLabel>
                      <Input
                        id="official-printing-date"
                        type="date"
                        value={metadata.printingDate}
                        aria-invalid={Boolean(fieldErrors.printingDate)}
                        onChange={(event) =>
                          updateMetadata('printingDate', event.target.value)
                        }
                      />
                      <FieldError>{fieldErrors.printingDate}</FieldError>
                    </Field>
                  </FieldGroup>
                </section>

                {exportError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {exportError}
                  </p>
                )}
              </div>
            )}
          </DialogBody>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {validation?.valid ? '取消' : '关闭并修改正文'}
            </Button>
            {validation?.valid && document && (
              <Button type="submit" disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <FileDown data-icon="inline-start" />
                )}
                生成并下载 DOCX
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
