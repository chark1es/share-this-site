import React, { useState, useMemo } from 'react';
import {
  Stack,
  Card,
  Text,
  Button,
  Group,
  TextInput,
  Textarea,
  Select,
  Badge,
  Alert,
  Box,
  Title,
  CopyButton,
  Tooltip,
  ActionIcon,
  Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconAlertCircle,
  IconCopy,
  IconCode,
  IconTrash,
} from '@tabler/icons-react';
import { CodeHighlight } from '@mantine/code-highlight';

const LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
];

const TTL_OPTIONS = [
  { value: '60', label: '1 hour' },
  { value: '360', label: '6 hours' },
  { value: '1440', label: '24 hours' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '7 days' },
];

interface Snippet {
  key: string;
  url: string;
  expireAt: string;
  content: string;
  language: string;
  title: string;
}

export default function SnippetShare() {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [ttl, setTtl] = useState('1440');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  const disabled = useMemo(
    () => loading || !content.trim(),
    [loading, content]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/snippets/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          language,
          title: title.trim() || 'Untitled',
          ttlMinutes: Number(ttl),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to create snippet');

      // Add to snippets list
      setSnippets((prev) => [
        {
          key: data.key,
          url: data.url,
          expireAt: data.expireAt,
          content: content.trim(),
          language,
          title: title.trim() || 'Untitled',
        },
        ...prev,
      ]);

      // Reset form
      setContent('');
      setTitle('');
      setLanguage('plaintext');

      notifications.show({
        title: 'Success!',
        message: 'Your snippet has been created',
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to create snippet');
      notifications.show({
        title: 'Error',
        message: err?.message || 'Failed to create snippet',
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setLoading(false);
    }
  };

  const removeSnippet = (key: string) => {
    setSnippets((prev) => prev.filter((s) => s.key !== key));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    notifications.show({
      title: 'Copied',
      message: `${label} copied to clipboard`,
      color: 'blue',
      icon: <IconCopy size={16} />,
      autoClose: 2000,
    });
  };

  return (
    <Stack gap="lg">
      <Card
        withBorder
        radius="lg"
        p="xl"
        shadow="md"
        className="bg-white border-gray-200"
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="lg">
            <Group justify="space-between" align="center">
              <Box>
                <Title order={3} className="text-xl font-bold">
                  Create Snippet
                </Title>
                <Text size="sm" c="dimmed" mt="xs">
                  Share code or text with syntax highlighting
                </Text>
              </Box>
              <IconCode size={32} className="text-purple-500" />
            </Group>

            <Divider />

            <TextInput
              label="Title (optional)"
              placeholder="My awesome snippet"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              size="md"
            />

            <Select
              label="Language"
              placeholder="Select language"
              value={language}
              onChange={(value) => setLanguage(value || 'plaintext')}
              data={LANGUAGE_OPTIONS}
              searchable
              size="md"
            />

            <Textarea
              label="Content"
              placeholder="Paste your code or text here..."
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
              minRows={8}
              maxRows={20}
              autosize
              required
              size="md"
              styles={{
                input: {
                  fontFamily: 'monospace',
                  fontSize: '14px',
                },
              }}
            />

            <Select
              label="Expires after"
              value={ttl}
              onChange={(value) => setTtl(value || '1440')}
              data={TTL_OPTIONS}
              size="md"
            />

            <Button
              type="submit"
              loading={loading}
              disabled={disabled}
              size="lg"
              leftSection={<IconCode size={18} />}
              fullWidth
              color="purple"
            >
              {loading ? 'Creating...' : 'Create Snippet'}
            </Button>

            <Text size="xs" c="dimmed" ta="center">
              Snippets are stored securely and expire automatically
            </Text>
          </Stack>
        </form>
      </Card>

      {error && (
        <Alert
          color="red"
          title="Error"
          icon={<IconAlertCircle size={18} />}
          onClose={() => setError(null)}
          withCloseButton
        >
          {error}
        </Alert>
      )}

      {snippets.length > 0 && (
        <Card
          withBorder
          radius="lg"
          p="xl"
          shadow="md"
          className="bg-white border-gray-200"
        >
          <Stack gap="lg">
            <Group justify="space-between" align="center">
              <Text fw={600} size="lg">
                Your Snippets
              </Text>
              <Badge variant="light" color="gray">
                {snippets.length}
              </Badge>
            </Group>

            <Stack gap="md">
              {snippets.map((snippet) => (
                <Card
                  key={snippet.key}
                  withBorder
                  radius="md"
                  p="md"
                  className="bg-gray-50 border-gray-300 hover:shadow-md transition-shadow duration-200"
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" mb="xs">
                          <Text fw={600} size="sm" className="truncate">
                            {snippet.title}
                          </Text>
                          <Badge size="xs" variant="light" color="purple">
                            {snippet.language}
                          </Badge>
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                          <Text
                            size="xs"
                            c="dimmed"
                            className="font-mono truncate"
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            {snippet.url}
                          </Text>
                          <CopyButton value={snippet.url} timeout={1500}>
                            {({ copied, copy }) => (
                              <Tooltip
                                label={copied ? 'Copied' : 'Copy URL'}
                                withArrow
                              >
                                <ActionIcon
                                  variant="subtle"
                                  color={copied ? 'teal' : 'gray'}
                                  onClick={copy}
                                  size="sm"
                                >
                                  {copied ? (
                                    <IconCheck size={14} />
                                  ) : (
                                    <IconCopy size={14} />
                                  )}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                      </Box>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => removeSnippet(snippet.key)}
                        size="sm"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>

                    <Box
                      className="rounded-md overflow-hidden"
                      style={{ maxHeight: '200px', overflow: 'auto' }}
                    >
                      {snippet.language === 'plaintext' ? (
                        <Box
                          p="sm"
                          className="bg-gray-800 text-gray-100 font-mono text-sm"
                          style={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {snippet.content}
                        </Box>
                      ) : (
                        <CodeHighlight
                          code={snippet.content}
                          language={snippet.language}
                          withLineNumbers
                        />
                      )}
                    </Box>

                    <Group justify="space-between" mt="xs">
                      <Text size="xs" c="dimmed">
                        Expires: {new Date(snippet.expireAt).toLocaleString()}
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        color="purple"
                        onClick={() =>
                          copyToClipboard(snippet.content, 'Content')
                        }
                        leftSection={<IconCopy size={12} />}
                      >
                        Copy Content
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

