export interface StorageProvider {
	upload(path: string, content: Buffer | string): Promise<string>;

	download(path: string): Promise<Buffer>;

	delete(path: string): Promise<void>;

	exists(path: string): Promise<boolean>;

	list(prefix: string): Promise<string[]>;
}
