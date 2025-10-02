/*Lucie: réfléchir à une solution pour avoir qqchose qui ressemble à ça: summarize(source: LSummary[] | blocks: RawDataBlock[]; engine: {level: number; model: string; callTimeoutMs: number; 
    compressionLevel: number = 0.6; wiggle: number = 0.1; overflowMode: 'accept' | 'regenerate'; underflowMode: 'accept' | 'regenerate'; regenerateRatioStep: number = 0.1; allowHeuristicFallback: boolean = false;
    summaryLenRange: number[] = [0, Number.Infinity] 
    })


    

    regenerateRatioStep, un step pour les regenerate, que ce soit en over ou under flow, 
        exemple:on a demandé au llm 0.6 (compressionLevel) * 1800 chars (taille en char totale des blocks ou summary a traiter) = 1080 (computedSummaryLen, seule valeur qu'on passe vraiment au llm), 
        mais il en génère  700 (on est en politique underflow), 1080 - 700 = 380, 380 / 1080 = 0.35, si le wiggle est resté la valeur par défaut (0.1), 0.35 est trop gros.
        donc si la politique pour underflow est accept, on s'en fout on accepte quand meme, si la politique pour underflow est regenerate, on va regenerate en 
        passant au llm cette fois (0.6 (compressionLevel) + 0.1 (regenerateRatioStep par défaut)) * 1800 = (0.7 * 1080) soit 1260,

        on peut quand meme renseigner en option "summaryLenRange", 
          exemple: si la computedSummaryLen est de 1080, mais qu'elle est en dehors du summaryLenRange, on vient caper cette computedSummaryLen avant de l'envoyer au llm,
        

    

   en clair, unifier la manière dont on génère les summary pour L1 ou L2, et ainsi de suite, et prévoir de pouvoir itérer sur des l1 vers l2, l3, l4, etc... avec exactement le meme genre d'appel.
   La préparation des blocks pour L1 doit se faire en dehors, et personnalisée si c'est un chat (remap des interlocuteurs (user vs assistant se remappent sur des param))
   ou si c'est un document, (authorName: "LuciformResearch" ? et peut etre authorType: "person" | "organisation", extraction éventuelles métadonnées, date de creation, modification, etc...)
   ou si c'est un mail, (type: "recipient" | "sender", recipient name: "Lucie Defraiteur", recipientEmail: "luciedefraiteur@luciformresearch.com", senderName: "Some company or person...", senderEmail: "somemail@companyName.com")
    et le llm recoit "tu impersonne ici le recipient" ou "tu impersonne ici le sender", selon le mode.

    exemple on est dans le cas d'une session de chat, on a prepareBlocks qu'on appel en disant qu'il s'agit d'un chat, avec des options spécifiques au chat,
    cette fonction prepareBlocks remap les interolucteurs selon les options, et prépare un prompt spécifique au chat, en addition des blocks,
    "Ici tu es" + assistantName + "tu relis une conversation passée avec " + userName + "tu t'exprime à la premiere personne, mais tu ne dis jamais tu" ... etc... 
    Bon biensur la c'est très grotesque mais tu peux t'inspirer de ce qui est déja en place pour faire mieux.

    dans le cas d'un document, on aura par exemple "Ici tu es un employé aux rapports, qui représente l'organisation" + organisationName + "tu t'exprime a la premiere personne du pluriel" ...
    ou bien d'un document personnel: "Ici tu es " + userName + "tu relis un document que tu as écrit par le passé, pour en faire un rapport, tu t'exprieme a la premiere personne du singulier"...    

  ne pas coder tout de suite trop ces modes document et mail, mais les prévoir.

  avoir dans une fonction séparée processTagsAndArtifacts par exemple, de quoi extraire les artefacts et tags algorithmiquement, comme dans l'actuel compress_memory.ts,


  Pour résumer, on veut ces parametres que j'ai donné, qu'ils fonctionnent presque pareil pour L1 ou L2, L3, etc...
  mais les L1 utilisent des blocks préparés ainsi qu'un prompt additionnel donnés par prepareBlocks, et les autres des LSummary ainsi que peut etre un prompt additionnel aussi j'en sais rien.

    C'est un concept biensur il y a peut etre des incohérences, et il faut reprendre autant de bonnes idées que possible des implémentations actuelles pour summarizeL1Blocks et summarizeL2Groups

    Ce que je te demande c'est d'imaginer une solution qui simplifie beaucoup les parametres, une facilité d'usage haut level, et utiliser au maximum le meme code pour L1 et L2,
    tu es libre de revoir certains principes/noms de fonctions/parametres/concepts évoqués si tu pense avoir une solution plus efficace.

  
  */