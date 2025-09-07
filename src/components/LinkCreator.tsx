import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Group,
  Stack,
  TextInput,
  SegmentedControl,
  Code,
  Card,
  Text,
  CopyButton,
  Tooltip,
  Badge,
  Alert,
  Loader,
  NumberInput,
  Select,
  ActionIcon
} from '@mantine/core';
import { IconLink, IconCheck, IconCopy, IconAlertCircle, IconClipboard, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

function ttlOptions() {
  return [
    { value: '15', label: '15m' },
    { value: '60', label: '1h' },
    { value: '360', label: '6h' },
    { value: '1440', label: '24h' },
    { value: '10080', label: '7d' },
    { value: 'custom', label: 'Custom' },
  ];
}

export default function LinkCreator() {
  const [url, setUrl] = useState('');
  const [ttl, setTtl] = useState('60');
  const [customTime, setCustomTime] = useState(60);
  const [customUnit, setCustomUnit] = useState('minutes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [links, setLinks] = useState<Array<{ key: string; shortUrl: string; url: string; expireAt: string }>>([]);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const finalTtl = useMemo(() => {
    if (ttl === 'custom') {
      const multiplier = customUnit === 'minutes' ? 1 : customUnit === 'hours' ? 60 : 1440;
      return customTime * multiplier;
    }
    return Number(ttl);
  }, [ttl, customTime, customUnit]);

  function validateUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return 'Enter a URL';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(candidate);
      // Require a dot and at least two letters after the last dot
      if (!/\.[a-zA-Z]{2,}(?:[:/]|$)/.test(u.host + u.pathname)) {
        return 'Use a valid domain (e.g. example.com)';
      }
      return null;
    } catch {
      return 'Enter a valid URL';
    }
  }

  const disabled = useMemo(() => loading || !url.trim() || !!inputError, [loading, url, inputError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Basic validation
    const earlyErr = validateUrl(url);
    if (earlyErr) {
      setInputError(earlyErr);
      setLoading(false);
      notifications.show({ title: 'Invalid URL', message: earlyErr, color: 'red', icon: <IconAlertCircle size={16} /> });
      return;
    }

    // Normalize URL: prepend https:// if missing a scheme
    const normalizedUrl = (() => {
      const trimmed = url.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `https://${trimmed}`;
    })();

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, ttlMinutes: finalTtl }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || 'Failed to create link');

      // Insert new link at the top of the list
      setLinks((prev) => [data, ...prev]);
      setJustAddedKey(data.key);
      setUrl('');
      setInputError(null);

      notifications.show({
        title: 'Success!',
        message: 'Your temporary link has been created',
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (err: any) {
      const errorMessage = err?.message || 'Something went wrong';
      setError(errorMessage);
      notifications.show({
        title: 'Error',
        message: errorMessage,
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setLoading(false);
    }
  }

  // Persist recent links locally for a smoother UX (max 20)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('recent-links');
      if (raw) setLinks(JSON.parse(raw));
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('recent-links', JSON.stringify(links.slice(0, 20)));
    } catch { }
  }, [links]);

  const handleCopy = () => {
    notifications.show({
      title: 'Copied!',
      message: 'Link copied to clipboard',
      color: 'blue',
      icon: <IconCopy size={16} />,
    });
  };
  // Auto-scroll to newly added link
  useEffect(() => {
    if (!justAddedKey) return;
    const el = itemRefs.current[justAddedKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [justAddedKey, links]);


  return (
    <div className="animate-fade-in">
      <Stack gap="lg">
        <Card
          withBorder
          radius="lg"
          p="lg"
          shadow="md"
          className="bg-white border-gray-200 hover:shadow-lg transition-shadow duration-200 sm:p-2xl"
        >
          <form onSubmit={handleSubmit}>
            <Stack gap="xl" className="sm:gap-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <TextInput
                  label="Destination URL"
                  description="Enter the URL you want to shorten. We'll add https:// if needed."
                  placeholder="https://example.com/your-long-url"
                  value={url}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setUrl(v);
                    setInputError(validateUrl(v));
                  }}
                  required
                  size="lg"
                  aria-describedby="url-help"
                  error={inputError || undefined}
                  leftSection={<IconLink size={20} />}
                  rightSectionWidth={72}
                  rightSection={
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Paste from clipboard" withArrow>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label="Paste from clipboard"
                          onClick={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (text) setUrl(text);
                            } catch { }
                          }}
                        >
                          <IconClipboard size={16} />
                        </ActionIcon>
                      </Tooltip>
                      {url && (
                        <Tooltip label="Clear" withArrow>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            color="gray"
                            aria-label="Clear URL"
                            onClick={() => setUrl('')}
                          >
                            <IconX size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  }
                  className="transition-all duration-200"
                  styles={{
                    input: {
                      '&:focus': {
                        borderColor: 'var(--mantine-color-blue-6)',
                        boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.1)',
                      },
                    },
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !disabled) {
                      (e.target as HTMLInputElement).form?.requestSubmit();
                    }
                  }}
                />

                <Button
                  type="submit"
                  loading={loading}
                  disabled={disabled}
                  size="lg"
                  leftSection={loading ? <Loader size={18} /> : <IconLink size={18} />}
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  color="blue"
                >
                  {loading ? 'Creating...' : 'Create Link'}
                </Button>
              </div>
              <Text id="url-help" size="sm" c="dimmed" className="-mt-2">
                Tip: Press Ctrl/⌘ + Enter to create the link
              </Text>

              <fieldset className="w-full" aria-describedby="ttl-help">
                <legend className="sr-only">Choose how long the link should remain active</legend>
                <Stack gap="md" align="center">
                  <Text id="ttl-help" size="md" fw={500} className="text-gray-700">
                    Link expires after
                  </Text>
                  <SegmentedControl
                    value={ttl}
                    onChange={(v) => setTtl(v)}
                    data={ttlOptions()}
                    size="lg"
                    className="w-full max-w-md"
                  />

                  {ttl === 'custom' && (
                    <Group gap="md" className="w-full max-w-md" align="end">
                      <NumberInput
                        label="Duration"
                        placeholder="Enter time"
                        value={customTime}
                        onChange={(val) => setCustomTime(Number(val) || 1)}
                        min={1}
                        max={customUnit === 'minutes' ? 10080 : customUnit === 'hours' ? 168 : 7}
                        size="md"
                        className="flex-1"
                      />
                      <Select
                        label="Unit"
                        value={customUnit}
                        onChange={(val) => setCustomUnit(val || 'minutes')}
                        data={[
                          { value: 'minutes', label: 'Minutes' },
                          { value: 'hours', label: 'Hours' },
                          { value: 'days', label: 'Days' },
                        ]}
                        size="md"
                        w={160}
                        comboboxProps={{ width: 200, position: 'bottom-start' }}
                      />
                    </Group>
                  )}
                </Stack>
              </fieldset>


            </Stack>
          </form>
        </Card>

        {error && (
          <Alert
            color="red"
            title="Error"
            icon={<IconAlertCircle size={18} />}
            className="animate-slide-up"
            radius="lg"
            p="lg"
          >
            {error}
          </Alert>
        )}

        {links.length > 0 && (
          <Card
            withBorder
            radius="lg"
            p="xl"
            shadow="md"
            className="bg-white border-gray-200 animate-slide-up sm:p-2xl"
            aria-live="polite"
          >
            <Stack gap="lg">
              <Group justify="space-between" align="center">
                <Text fw={600} size="lg">Your links</Text>
                <Badge variant="light" color="gray">{links.length}</Badge>
              </Group>

              <Stack gap="sm">
                {links.map((l) => (
                  <div
                    key={l.key}
                    ref={(el) => {
                      if (el) itemRefs.current[l.key] = el;
                    }}
                    className="p-4 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-50/70 transition-colors"
                  >
                    <Group justify="space-between" wrap="nowrap" align="center">
                      <Group gap="sm" wrap="nowrap" className="min-w-0">
                        {justAddedKey === l.key && (
                          <Badge color="teal" variant="light" size="sm">New</Badge>
                        )}
                        <Code className="px-3 py-2 rounded-lg break-all text-sm bg-white border">{l.shortUrl}</Code>
                      </Group>
                      <Group gap="xs" wrap="nowrap">
                        <CopyButton value={l.shortUrl} timeout={2000}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copied!' : 'Copy'} withArrow>
                              <ActionIcon
                                variant="subtle"
                                color={copied ? 'teal' : 'blue'}
                                aria-label="Copy short link"
                                onClick={() => { copy(); handleCopy(); }}
                              >
                                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                        <Tooltip label="Remove" withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label="Remove from list"
                            onClick={() => setLinks((prev) => prev.filter((x) => x.key !== l.key))}
                          >
                            <IconX size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                    <div className="mt-2 text-sm text-gray-600 space-y-1">
                      <div className="truncate">
                        <strong>Destination:</strong>{' '}
                        <span className="break-all">{l.url}</span>
                      </div>
                      <div>
                        <strong>Expires:</strong> {new Date(l.expireAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </Stack>
            </Stack>
          </Card>
        )}
      </Stack>
    </div>
  );
}

